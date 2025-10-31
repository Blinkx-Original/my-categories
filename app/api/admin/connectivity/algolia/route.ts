import { NextResponse } from 'next/server';

import {
  MissingAlgoliaEnvError,
  verifyAlgoliaIndex,
} from '@/lib/server/algolia';

export async function POST() {
  try {
    const result = await verifyAlgoliaIndex();
    if (!result.ok) {
      console.warn('algolia_connectivity_result', {
        ok: false,
        errorCode: result.errorCode,
        latencyMs: result.latencyMs,
      });
      return NextResponse.json({
        ok: false,
        error_code: result.errorCode ?? 'unknown',
        latency_ms: result.latencyMs,
        ray_ids: [],
      });
    }

    console.info('algolia_connectivity_result', {
      ok: true,
      latencyMs: result.latencyMs,
    });

    return NextResponse.json({
      ok: true,
      latency_ms: result.latencyMs,
      ray_ids: [],
    });
  } catch (error) {
    if (error instanceof MissingAlgoliaEnvError) {
      return NextResponse.json({
        ok: false,
        error_code: 'missing_env',
        ray_ids: [],
      });
    }

    console.error('algolia_connectivity_error', {
      error: (error as Error)?.message,
    });

    return NextResponse.json({
      ok: false,
      error_code: 'unexpected_error',
      ray_ids: [],
    });
  }
}
