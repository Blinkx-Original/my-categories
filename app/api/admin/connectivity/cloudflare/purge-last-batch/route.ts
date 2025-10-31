import { NextResponse } from 'next/server';

import {
  MissingCloudflarePurgeEnvError,
  getCloudflarePurgeConfig,
  purgeCloudflareUrls,
} from '@/lib/server/cloudflare/purge';
import { getLastCloudflarePurgeBatch } from '@/lib/server/cloudflare/state';

export async function POST() {
  try {
    const config = getCloudflarePurgeConfig();
    if (!config) {
      throw new MissingCloudflarePurgeEnvError();
    }

    const batch = getLastCloudflarePurgeBatch();
    if (!batch || batch.urls.length === 0) {
      return NextResponse.json({
        ok: false,
        error_code: 'no_previous_batch',
        ray_ids: [],
      });
    }

    const results = await purgeCloudflareUrls(batch.urls, config);
    const rayIds = results.flatMap((result) => result.rayIds);
    const latency = results.reduce((total, result) => total + result.latencyMs, 0);
    const attempts = results.reduce((total, result) => total + result.attempts, 0);
    const ok = results.every((result) => result.ok);

    if (ok) {
      console.info('cloudflare_purge_last_batch', {
        latencyMs: latency,
        attempts,
        rayIds,
      });
    } else {
      console.warn('cloudflare_purge_last_batch_error', {
        latencyMs: latency,
        attempts,
        rayIds,
      });
    }

    return NextResponse.json({
      ok,
      latency_ms: latency,
      ray_ids: rayIds,
      attempts,
      error_code: ok ? undefined : 'http_error',
    });
  } catch (error) {
    if (error instanceof MissingCloudflarePurgeEnvError) {
      return NextResponse.json({
        ok: false,
        error_code: 'missing_env',
        ray_ids: [],
      });
    }

    console.error('cloudflare_purge_last_batch_unexpected', {
      error: (error as Error)?.message,
    });

    return NextResponse.json({
      ok: false,
      error_code: 'unexpected_error',
      ray_ids: [],
    });
  }
}
