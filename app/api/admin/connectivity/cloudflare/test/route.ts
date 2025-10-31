import { NextResponse } from 'next/server';

import {
  MissingCloudflareImagesEnvError,
  testCloudflareImages,
} from '@/lib/server/cloudflare/images';

export async function GET() {
  try {
    const result = await testCloudflareImages();
    const rayIds = result.rayId ? [result.rayId] : [];
    if (!result.ok) {
      return NextResponse.json({
        ok: false,
        error_code: 'http_error',
        latency_ms: result.latencyMs,
        ray_ids: rayIds,
      });
    }

    return NextResponse.json({
      ok: true,
      latency_ms: result.latencyMs,
      ray_ids: rayIds,
    });
  } catch (error) {
    if (error instanceof MissingCloudflareImagesEnvError) {
      return NextResponse.json({
        ok: false,
        error_code: 'missing_env',
        ray_ids: [],
      });
    }

    console.error('cloudflare_images_test_error', {
      error: (error as Error)?.message,
    });

    return NextResponse.json({
      ok: false,
      error_code: 'unexpected_error',
      ray_ids: [],
    });
  }
}
