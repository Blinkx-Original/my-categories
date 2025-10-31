import { NextResponse } from 'next/server';

import { getPrismaClient } from '@/lib/server/tidb/client';
import { loadTiDbCredentials } from '@/lib/server/tidb/config';
import { toDbErrorInfo } from '@/lib/server/tidb/errors';

export async function GET() {
  const credentials = loadTiDbCredentials();
  if (!credentials) {
    return NextResponse.json({
      ok: false,
      error_code: 'missing_env',
      ray_ids: [],
    });
  }

  const prisma = getPrismaClient();
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    const [aggregate] = await prisma.$queryRawUnsafe<
      { published: number; lastmod: Date | null }[]
    >('SELECT COUNT(*) as published, MAX(published_at) as lastmod FROM books');

    const latency = Date.now() - startedAt;

    const payload = {
      ok: true,
      latency_ms: latency,
      ray_ids: [],
      published: aggregate?.published ?? 0,
      lastmod: aggregate?.lastmod ?? null,
    } as const;

    console.info('tidb_connectivity_result', {
      ok: true,
      latencyMs: latency,
      published: payload.published,
      lastmod: payload.lastmod,
    });

    return NextResponse.json(payload);
  } catch (error) {
    const info = toDbErrorInfo(error);
    const latency = Date.now() - startedAt;

    console.error('tidb_connectivity_error', {
      code: info.code,
      message: info.message,
      sqlState: info.sqlState,
    });

    return NextResponse.json({
      ok: false,
      error_code: info.code === 'unknown' ? 'sql_error' : info.code,
      latency_ms: latency,
      ray_ids: [],
      details: info.message,
    });
  }
}
