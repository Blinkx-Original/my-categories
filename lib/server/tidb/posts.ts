import 'server-only';

import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { revalidateBlogPaths } from '@/lib/server/cache';

import { runInTransaction } from './mysql';
import { getCategoriesTable, getPostsTable } from './schema';

export interface BlogPostUpdatePayload {
  title?: string | null;
  title_h1?: string | null;
  short_summary?: string | null;
  content_html?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  primary_cta_label?: string | null;
  primary_cta_url?: string | null;
  secondary_cta_label?: string | null;
  secondary_cta_url?: string | null;
  category_slug?: string | null;
  hero_image_url?: string | null;
  published_at?: string | null;
  is_published?: boolean | null;
}

interface ColumnConfig {
  column: string;
  type: 'string' | 'text' | 'html' | 'url' | 'datetime' | 'boolean';
  maxLength?: number;
}

const BLOG_COLUMNS: Record<keyof BlogPostUpdatePayload, ColumnConfig> = {
  title: { column: 'title', type: 'string', maxLength: 255 },
  title_h1: { column: 'title_h1', type: 'string', maxLength: 255 },
  short_summary: { column: 'short_summary', type: 'text', maxLength: 1024 },
  content_html: { column: 'content_html', type: 'html' },
  seo_title: { column: 'seo_title', type: 'string', maxLength: 255 },
  seo_description: { column: 'seo_description', type: 'text', maxLength: 512 },
  primary_cta_label: { column: 'primary_cta_label', type: 'string', maxLength: 120 },
  primary_cta_url: { column: 'primary_cta_url', type: 'url', maxLength: 2048 },
  secondary_cta_label: { column: 'secondary_cta_label', type: 'string', maxLength: 120 },
  secondary_cta_url: { column: 'secondary_cta_url', type: 'url', maxLength: 2048 },
  category_slug: { column: 'category_slug', type: 'string', maxLength: 191 },
  hero_image_url: { column: 'hero_image_url', type: 'url', maxLength: 2048 },
  published_at: { column: 'published_at', type: 'datetime' },
  is_published: { column: 'is_published', type: 'boolean' },
};

export async function updateBlogPost(slug: string, payload: BlogPostUpdatePayload) {
  const normalizedSlug = normalizeSlug(slug);

  return runInTransaction(async (connection) => {
    const table = getPostsTable();
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT * FROM ${table} WHERE slug = ? LIMIT 1 FOR UPDATE`,
      [normalizedSlug]
    );
    const existing = rows[0];
    if (!existing) {
      return { rowsAffected: 0, post: null };
    }

    const requestedSlug = (payload as Record<string, unknown>).slug;
    if (typeof requestedSlug === 'string') {
      const trimmed = requestedSlug.trim();
      if (trimmed && trimmed !== normalizedSlug) {
        if (existing.is_published) {
          throw new SlugLockedError();
        }
        throw new Error('Slug changes are not allowed.');
      }
    }

    if (payload.category_slug) {
      await assertCategoryExists(connection, payload.category_slug);
    }

    const { assignments, values } = buildAssignments(payload, existing);
    if (assignments.length === 0) {
      return { rowsAffected: 0, post: mapRow(existing) };
    }

    const updateSql = `UPDATE ${table} SET ${assignments.join(', ')}, last_tidb_update_at = NOW(6) WHERE slug = ?`;
    const [result] = await connection.execute<ResultSetHeader>(updateSql, [...values, normalizedSlug]);
    const rowsAffected = Number(result.affectedRows ?? 0);

    const [reloadedRows] = await connection.query<RowDataPacket[]>(
      `SELECT * FROM ${table} WHERE slug = ? LIMIT 1`,
      [normalizedSlug]
    );
    const reloaded = reloadedRows[0] ?? existing;

    await revalidateBlogPaths(normalizedSlug, [existing.category_slug as string | null, reloaded.category_slug as string | null]);

    return { rowsAffected, post: mapRow(reloaded) };
  });
}

export class SlugLockedError extends Error {
  constructor() {
    super('slug_locked');
    this.name = 'SlugLockedError';
  }
}

async function assertCategoryExists(connection: PoolConnection, categorySlug: string) {
  const categoriesTable = getCategoriesTable();
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT slug FROM ${categoriesTable} WHERE slug = ? LIMIT 1`,
    [categorySlug.trim()]
  );
  if (rows.length === 0) {
    throw new Error(`Category ${categorySlug} does not exist.`);
  }
}

function buildAssignments(payload: BlogPostUpdatePayload, existing: RowDataPacket) {
  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const [key, config] of Object.entries(BLOG_COLUMNS) as [keyof BlogPostUpdatePayload, ColumnConfig][]) {
    if (!(key in payload)) {
      continue;
    }
    const incoming = payload[key];
    const normalized = normalizeValue(incoming, config, key);
    const currentValue = existing[config.column];
    if (areEqual(currentValue, normalized, config.type)) {
      continue;
    }
    assignments.push(`\`${config.column}\` = ?`);
    values.push(normalized);
  }

  return { assignments, values };
}

function normalizeValue(value: unknown, config: ColumnConfig, key: string) {
  if (value == null) {
    return null;
  }

  switch (config.type) {
    case 'string':
    case 'text': {
      if (typeof value !== 'string') {
        throw new Error(`Field ${key} must be a string.`);
      }
      const trimmed = value.trim();
      if (config.maxLength && trimmed.length > config.maxLength) {
        throw new Error(`Field ${key} exceeds maximum length of ${config.maxLength} characters.`);
      }
      return trimmed.length === 0 ? null : trimmed;
    }
    case 'html': {
      if (typeof value !== 'string') {
        throw new Error(`Field ${key} must be a string.`);
      }
      return value.replace(/\r\n/g, '\n').trim();
    }
    case 'url': {
      if (typeof value !== 'string') {
        throw new Error(`Field ${key} must be a string.`);
      }
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return null;
      }
      if (!/^https?:\/\//i.test(trimmed)) {
        throw new Error(`Field ${key} must be a valid URL.`);
      }
      if (config.maxLength && trimmed.length > config.maxLength) {
        throw new Error(`Field ${key} exceeds maximum length of ${config.maxLength} characters.`);
      }
      return trimmed;
    }
    case 'datetime': {
      if (typeof value !== 'string') {
        throw new Error(`Field ${key} must be an ISO date string.`);
      }
      const date = new Date(value);
      if (Number.isNaN(date.valueOf())) {
        throw new Error(`Field ${key} must be an ISO date string.`);
      }
      return new Date(date).toISOString().slice(0, 19).replace('T', ' ');
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        throw new Error(`Field ${key} must be a boolean.`);
      }
      return value ? 1 : 0;
    }
    default:
      return value;
  }
}

function areEqual(current: unknown, next: unknown, type: ColumnConfig['type']) {
  if (current == null && next == null) {
    return true;
  }
  if (type === 'boolean') {
    return Boolean(current) === Boolean(next);
  }
  if (type === 'datetime') {
    const currentString = current instanceof Date ? current.toISOString() : String(current ?? '');
    return currentString.startsWith(String(next ?? ''));
  }
  return current === next;
}

function mapRow(row: RowDataPacket): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    result[key] = normalizeResponseValue(value);
  }
  return result;
}

function normalizeResponseValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

function normalizeSlug(slug: string): string {
  if (typeof slug !== 'string' || slug.trim().length === 0) {
    throw new Error('Slug is required.');
  }
  const trimmed = slug.trim();
  if (trimmed.length > 191) {
    throw new Error('Slug exceeds maximum length of 191 characters.');
  }
  return trimmed;
}
