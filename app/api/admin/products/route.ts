import { NextRequest, NextResponse } from 'next/server';

import { loadTiDbCredentials } from '@/lib/server/tidb/config';
import { toDbErrorInfo } from '@/lib/server/tidb/errors';
import type { ProductWritePayload } from '@/lib/server/tidb/products';
import { updateProduct } from '@/lib/server/tidb/products';

const ALLOWED_FIELDS: (keyof ProductWritePayload)[] = [
  'title_h1',
  'short_summary',
  'desc_html',
  'primary_cta_label',
  'primary_cta_url',
  'secondary_cta_label',
  'secondary_cta_url',
  'price_display',
  'price_currency',
  'price_amount',
  'category_slug',
  'hero_image_url',
  'gallery_image_urls',
  'seo_title',
  'seo_description',
  'badge_label',
  'availability_label',
];

export async function POST(request: NextRequest) {
  const credentials = loadTiDbCredentials();
  if (!credentials) {
    return NextResponse.json({ ok: false, error_code: 'missing_env' }, { status: 503 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch (error) {
    console.warn('admin_product_update_invalid_json', { error: (error as Error)?.message });
    return NextResponse.json({ ok: false, error_code: 'invalid_payload' }, { status: 400 });
  }

  const slugValue = payload.slug;
  if (typeof slugValue !== 'string' || slugValue.trim().length === 0) {
    return NextResponse.json({ ok: false, error_code: 'missing_slug' }, { status: 400 });
  }

  const updates: ProductWritePayload & Record<string, unknown> = { slug: slugValue.trim() };
  const updatesRecord = updates as Record<string, unknown>;
  let touched = 0;

  for (const field of ALLOWED_FIELDS) {
    if (field in payload) {
      updatesRecord[field] = payload[field];
      touched += 1;
    }
  }

  if (touched === 0) {
    return NextResponse.json({ ok: false, error_code: 'no_updates' }, { status: 400 });
  }

  try {
    const result = await updateProduct(updates);
    if (!result.found) {
      return NextResponse.json({ ok: false, error_code: 'product_not_found' }, { status: 404 });
    }

    if (result.rowsAffected === 0) {
      return NextResponse.json({ ok: true, rows_affected: 0, product: result.product });
    }

    console.info('admin_product_update', {
      slug: updates.slug,
      rowsAffected: result.rowsAffected,
    });

    return NextResponse.json({ ok: true, rows_affected: result.rowsAffected, product: result.product });
  } catch (error) {
    if (error instanceof Error && error.message && error.message.includes('Field')) {
      return NextResponse.json({ ok: false, error_code: 'invalid_payload', details: error.message }, { status: 400 });
    }
    const info = toDbErrorInfo(error);
    console.error('admin_product_update_error', {
      slug: updates.slug,
      code: info.code,
      message: info.message,
      sqlState: info.sqlState,
    });
    const status = info.code === 'auth_failed' ? 401 : info.code === 'timeout' ? 504 : 500;
    return NextResponse.json(
      { ok: false, error_code: info.code === 'unknown' ? 'sql_error' : info.code, details: info.message },
      { status }
    );
  }
}
