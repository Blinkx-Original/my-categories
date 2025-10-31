import { NextRequest, NextResponse } from 'next/server';

import {
  MissingCloudflarePurgeEnvError,
  MissingSiteUrlError,
  buildProductUrls,
  buildSitemapUrls,
  getCloudflarePurgeConfig,
  purgeCloudflareUrls,
  resolveSiteUrl,
} from '@/lib/server/cloudflare/purge';
import { recordCloudflarePurgeBatch } from '@/lib/server/cloudflare/state';

export async function POST(request: NextRequest) {
  try {
    const config = getCloudflarePurgeConfig();
    if (!config) {
      throw new MissingCloudflarePurgeEnvError();
    }

    const siteUrl = resolveSiteUrl(request);
    const payload = await request.json().catch(() => ({}));
    const slugs = Array.isArray(payload?.productSlugs)
      ? payload.productSlugs.filter((slug: unknown) => typeof slug === 'string')
      : [];
    const additional = Array.isArray(payload?.urls)
      ? payload.urls.filter((url: unknown) => typeof url === 'string')
      : [];

    const urlSet = new Set<string>([
      ...buildSitemapUrls(siteUrl),
      ...additional,
    ]);

    if (config.includeProductUrls) {
      for (const url of buildProductUrls(siteUrl, slugs)) {
        urlSet.add(url);
      }
    }

    const urls = Array.from(urlSet);
    recordCloudflarePurgeBatch(urls);

    const results = await purgeCloudflareUrls(urls, config);

    const rayIds = results.flatMap((result) => result.rayIds);
    const latency = results.reduce((acc, result) => acc + result.latencyMs, 0);
    const ok = results.every((result) => result.ok);

    const responseBody = {
      ok,
      ray_ids: rayIds,
      latency_ms: latency,
      attempts: results.reduce((acc, result) => acc + result.attempts, 0),
      error_code: ok ? undefined : 'http_error',
    } as const;

    const logMethod = ok ? console.info : console.warn;
    logMethod('cloudflare_purge_endpoint', {
      ok,
      latencyMs: latency,
      rayIds,
      attempts: responseBody.attempts,
    });

    return NextResponse.json(responseBody);
  } catch (error) {
    if (error instanceof MissingCloudflarePurgeEnvError) {
      return NextResponse.json({
        ok: false,
        error_code: 'missing_env',
        ray_ids: [],
      });
    }

    if (error instanceof MissingSiteUrlError) {
      return NextResponse.json({
        ok: false,
        error_code: 'missing_site_url',
        ray_ids: [],
      });
    }

    console.error('cloudflare_purge_endpoint_error', {
      error: (error as Error)?.message,
    });

    return NextResponse.json({
      ok: false,
      error_code: 'unexpected_error',
      ray_ids: [],
    });
  }
}
