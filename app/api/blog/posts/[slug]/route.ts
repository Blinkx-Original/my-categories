import { NextRequest, NextResponse } from 'next/server';

import { loadTiDbCredentials } from '@/lib/server/tidb/config';
import { toDbErrorInfo } from '@/lib/server/tidb/errors';
import type { BlogPostUpdatePayload } from '@/lib/server/tidb/posts';
import { SlugLockedError, updateBlogPost } from '@/lib/server/tidb/posts';

export async function PUT(request: NextRequest, context: { params: { slug: string } }) {
  const credentials = loadTiDbCredentials();
  if (!credentials) {
    return NextResponse.json({ ok: false, error_code: 'missing_env' }, { status: 503 });
  }

  const slug = context.params.slug;
  if (typeof slug !== 'string' || slug.trim().length === 0) {
    return NextResponse.json({ ok: false, error_code: 'missing_slug' }, { status: 400 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch (error) {
    console.warn('blog_post_update_invalid_json', { error: (error as Error)?.message });
    return NextResponse.json({ ok: false, error_code: 'invalid_payload' }, { status: 400 });
  }

  try {
    const result = await updateBlogPost(slug, payload as BlogPostUpdatePayload);
    if (!result.post) {
      return NextResponse.json({ ok: false, error_code: 'post_not_found' }, { status: 404 });
    }

    console.info('blog_post_update', {
      slug,
      rowsAffected: result.rowsAffected,
    });

    return NextResponse.json({ ok: true, rows_affected: result.rowsAffected, post: result.post });
  } catch (error) {
    if (error instanceof SlugLockedError) {
      return NextResponse.json({ ok: false, error_code: 'slug_locked' }, { status: 409 });
    }
    if (error instanceof Error && error.message && error.message.includes('Field')) {
      return NextResponse.json({ ok: false, error_code: 'invalid_payload', details: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.message.includes('Category')) {
      return NextResponse.json({ ok: false, error_code: 'invalid_category', details: error.message }, { status: 400 });
    }
    const info = toDbErrorInfo(error);
    console.error('blog_post_update_error', {
      slug,
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
