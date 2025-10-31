import { NextResponse } from 'next/server';

import { getPrismaClient } from '@/lib/server/tidb/client';
import {
  loadTiDbCredentials,
  loadTiDbProductMetricsConfig,
} from '@/lib/server/tidb/config';
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

  const metricsConfig = loadTiDbProductMetricsConfig();
  let metricsQuery: string;

  try {
    metricsQuery = buildMetricsQuery(metricsConfig);
  } catch (error) {
    const latency = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : 'Invalid metrics configuration';

    console.error('tidb_metrics_config_error', { message });

    return NextResponse.json({
      ok: false,
      error_code: 'invalid_config',
      latency_ms: latency,
      ray_ids: [],
      details: message,
    });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    const [aggregate] = await prisma.$queryRawUnsafe<
      { published: number | bigint | string | null; lastmod: Date | string | null }[]
    >(metricsQuery);

    const latency = Date.now() - startedAt;

    const published = normalizePublished(aggregate?.published);
    const lastmod = normalizeLastmod(aggregate?.lastmod);

    const payload = {
      ok: true,
      latency_ms: latency,
      ray_ids: [],
      published,
      lastmod,
    } as const;

    console.info('tidb_connectivity_result', {
      ok: true,
      latencyMs: latency,
      published,
      lastmod,
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

function buildMetricsQuery(config: ReturnType<typeof loadTiDbProductMetricsConfig>): string {
  const table = quoteIdentifier(config.table, 'table');
  const lastmod = quoteIdentifier(config.lastmodColumn, 'column');
  const where = config.whereClause?.trim();

  const base = `SELECT COUNT(*) as published, MAX(${lastmod}) as lastmod FROM ${table}`;
  if (!where) {
    return base;
  }
  return `${base} WHERE ${where}`;
}

function normalizePublished(value: number | bigint | string | null | undefined): number {
  if (value == null) {
    return 0;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    if (!Number.isFinite(asNumber)) {
      console.warn('tidb_connectivity_bigint_overflow', { value: value.toString() });
      return Number.MAX_SAFE_INTEGER;
    }
    return asNumber;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  console.warn('tidb_connectivity_unexpected_published_type', {
    value,
    type: typeof value,
  });
  return 0;
}

function normalizeLastmod(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.valueOf())) {
    return parsed.toISOString();
  }

  console.warn('tidb_connectivity_unexpected_lastmod_type', { value, type: typeof value });
  return null;
}

function quoteIdentifier(value: string, kind: 'table' | 'column'): string {
  const parts = value
    .split('.')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    throw new Error(`Missing ${kind} name in TiDB metrics configuration.`);
  }

  for (const part of parts) {
    if (!/^[A-Za-z0-9_]+$/.test(part)) {
      throw new Error(`Invalid ${kind} identifier segment: ${part}`);
    }
  }

  return parts.map((part) => `\`${part}\``).join('.');
}
