import { NextRequest, NextResponse } from 'next/server';

import { loadTiDbCredentials } from '@/lib/server/tidb/config';
import { toDbErrorInfo } from '@/lib/server/tidb/errors';
import type { ProductWritePayload } from '@/lib/server/tidb/products';
import { updateProduct } from '@/lib/server/tidb/products';

const WRITE_FIELDS = ['title_h1', 'short_summary', 'desc_html'] as const;

export async function POST(request: NextRequest) {
  const credentials = loadTiDbCredentials();
  if (!credentials) {
    return NextResponse.json({ ok: false, error_code: 'missing_env', ray_ids: [] });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch (error) {
    console.warn('tidb_update_invalid_json', { error: (error as Error)?.message });
    return NextResponse.json({ ok: false, error_code: 'invalid_payload', ray_ids: [] }, { status: 400 });
  }

  const slugValue = payload.slug;
  if (typeof slugValue !== 'string' || slugValue.trim().length === 0) {
    return NextResponse.json({ ok: false, error_code: 'missing_slug', ray_ids: [] }, { status: 400 });
  }

  const updates: ProductWritePayload & Record<string, unknown> = {
    slug: slugValue.trim(),
  };
  const updatesRecord = updates as Record<string, unknown>;
  let providedFields = 0;
  for (const field of WRITE_FIELDS) {
    if (field in payload) {
      updatesRecord[field] = payload[field];
      providedFields += 1;
    }
  }

  if (providedFields === 0) {
    return NextResponse.json({ ok: false, error_code: 'no_updates', ray_ids: [] }, { status: 400 });
  }

  try {
    const result = await updateProduct(updates);
    if (!result.found) {
      return NextResponse.json({ ok: false, error_code: 'product_not_found', ray_ids: [] }, { status: 404 });
    }
    if (result.rowsAffected === 0) {
      return NextResponse.json(
        { ok: false, error_code: 'no_updates', ray_ids: [], product: result.product },
        { status: 200 }
      );
    }

    console.info('tidb_write_test_success', {
      slug: slugValue.trim(),
      rowsAffected: result.rowsAffected,
    });

    return NextResponse.json({
      ok: true,
      ray_ids: [],
      rows_affected: result.rowsAffected,
      product: result.product,
    });
  } catch (error) {
    const info = toDbErrorInfo(error);
    console.error('tidb_write_test_error', {
      slug: slugValue.trim(),
      code: info.code,
      message: info.message,
      sqlState: info.sqlState,
    });
    const status = info.code === 'auth_failed' ? 401 : info.code === 'timeout' ? 504 : 500;
    return NextResponse.json(
      { ok: false, error_code: info.code === 'unknown' ? 'sql_error' : info.code, ray_ids: [], details: info.message },
      { status }
    );
  }
}
