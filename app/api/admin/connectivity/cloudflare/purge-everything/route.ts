import { NextResponse } from 'next/server';

import {
  MissingCloudflarePurgeEnvError,
  getCloudflarePurgeConfig,
  purgeCloudflareEverything,
} from '@/lib/server/cloudflare/purge';

export async function POST() {
  try {
    const config = getCloudflarePurgeConfig();
    if (!config) {
      throw new MissingCloudflarePurgeEnvError();
    }

    const result = await purgeCloudflareEverything(config);
    const responseBody = {
      ok: result.ok,
      latency_ms: result.latencyMs,
      ray_ids: result.rayIds,
      attempts: result.attempts,
      error_code: result.ok ? undefined : 'http_error',
    } as const;

    const logger = result.ok ? console.info : console.warn;
    logger('cloudflare_purge_everything_endpoint', {
      ok: result.ok,
      latencyMs: result.latencyMs,
      attempts: result.attempts,
      rayIds: result.rayIds,
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

    console.error('cloudflare_purge_everything_endpoint_error', {
      error: (error as Error)?.message,
    });

    return NextResponse.json({
      ok: false,
      error_code: 'unexpected_error',
      ray_ids: [],
    });
  }
}
