import { NextRequest, NextResponse } from 'next/server';

import {
  MissingSiteUrlError,
  resolveSiteUrl,
} from '@/lib/server/cloudflare/purge';

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const siteUrl = resolveSiteUrl(request);
    const response = await fetch(`${siteUrl}/sitemap.xml`, {
      method: 'GET',
      headers: {
        'User-Agent': 'vpp-connectivity-check',
      },
    });
    const latency = Date.now() - startedAt;

    if (!response.ok) {
      console.warn('revalidate_sitemap_failed', {
        status: response.status,
        siteUrl,
      });
      return NextResponse.json({
        ok: false,
        error_code: 'http_error',
        latency_ms: latency,
        ray_ids: [],
      });
    }

    console.info('revalidate_sitemap_success', {
      latencyMs: latency,
      siteUrl,
    });

    return NextResponse.json({
      ok: true,
      latency_ms: latency,
      ray_ids: [],
    });
  } catch (error) {
    if (error instanceof MissingSiteUrlError) {
      return NextResponse.json({
        ok: false,
        error_code: 'missing_site_url',
        ray_ids: [],
      });
    }

    console.error('revalidate_sitemap_unexpected', {
      error: (error as Error)?.message,
    });

    return NextResponse.json({
      ok: false,
      error_code: 'unexpected_error',
      ray_ids: [],
    });
  }
}
