import 'server-only';

import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { revalidateProductPaths } from '@/lib/server/cache';

import { getTiDbPool } from './mysql';
import { getProductsTable } from './schema';

export interface ProductWritePayload {
  slug: string;
  title_h1?: string | null;
  short_summary?: string | null;
  desc_html?: string | null;
  primary_cta_label?: string | null;
  primary_cta_url?: string | null;
  secondary_cta_label?: string | null;
  secondary_cta_url?: string | null;
  price_display?: string | null;
  price_currency?: string | null;
  price_amount?: number | string | null;
  category_slug?: string | null;
  hero_image_url?: string | null;
  gallery_image_urls?: string[] | null;
  seo_title?: string | null;
  seo_description?: string | null;
  badge_label?: string | null;
  availability_label?: string | null;
}

export interface ProductUpdateResult {
  rowsAffected: number;
  product: Record<string, unknown>;
  previousCategory?: string | null;
  found: boolean;
}

interface ColumnConfig {
  column: string;
  maxLength?: number;
  type: 'string' | 'text' | 'number' | 'json';
  allowNull?: boolean;
  sanitizer?: (value: unknown) => unknown;
}

const PRODUCT_COLUMNS: Record<keyof Omit<ProductWritePayload, 'slug'>, ColumnConfig> = {
  title_h1: { column: 'title_h1', maxLength: 255, type: 'string' },
  short_summary: { column: 'short_summary', maxLength: 512, type: 'text' },
  desc_html: { column: 'desc_html', type: 'text', sanitizer: normalizeHtml },
  primary_cta_label: { column: 'primary_cta_label', maxLength: 120, type: 'string' },
  primary_cta_url: { column: 'primary_cta_url', maxLength: 2048, type: 'string', sanitizer: normalizeUrl },
  secondary_cta_label: { column: 'secondary_cta_label', maxLength: 120, type: 'string' },
  secondary_cta_url: { column: 'secondary_cta_url', maxLength: 2048, type: 'string', sanitizer: normalizeUrl },
  price_display: { column: 'price_display', maxLength: 120, type: 'string' },
  price_currency: { column: 'price_currency', maxLength: 8, type: 'string' },
  price_amount: { column: 'price_amount', type: 'number' },
  category_slug: { column: 'category_slug', maxLength: 191, type: 'string' },
  hero_image_url: { column: 'hero_image_url', maxLength: 2048, type: 'string', sanitizer: normalizeUrl },
  gallery_image_urls: { column: 'gallery_image_urls', type: 'json', sanitizer: normalizeStringArray },
  seo_title: { column: 'seo_title', maxLength: 255, type: 'string' },
  seo_description: { column: 'seo_description', maxLength: 512, type: 'text' },
  badge_label: { column: 'badge_label', maxLength: 120, type: 'string' },
  availability_label: { column: 'availability_label', maxLength: 255, type: 'string' },
};

export async function updateProduct(payload: ProductWritePayload): Promise<ProductUpdateResult> {
  const normalizedSlug = normalizeSlug(payload.slug);
  const pool = getTiDbPool();

  const connection = await pool.getConnection();
  try {
    const table = getProductsTable();
    const [existingRows] = await connection.query<RowDataPacket[]>(
      `SELECT * FROM ${table} WHERE slug = ? LIMIT 1`,
      [normalizedSlug]
    );
    const existing = existingRows[0];
    if (!existing) {
      return { rowsAffected: 0, product: {}, previousCategory: null, found: false };
    }

    const { assignments, values } = buildUpdateAssignments(payload, existing);
    if (assignments.length === 0) {
      return {
        rowsAffected: 0,
        product: mapRow(existing),
        previousCategory: existing.category_slug,
        found: true,
      };
    }

    const sql = `UPDATE ${table} SET ${assignments.join(', ')}, last_tidb_update_at = NOW(6) WHERE slug = ?`;
    const [result] = await connection.execute<ResultSetHeader>(sql, [...values, normalizedSlug]);
    const rowsAffected = Number(result.affectedRows ?? 0);

    const [reloadedRows] = await connection.query<RowDataPacket[]>(
      `SELECT * FROM ${table} WHERE slug = ? LIMIT 1`,
      [normalizedSlug]
    );
    const reloaded = reloadedRows[0] ?? existing;

    const previousCategory = existing.category_slug as string | null | undefined;
    const nextCategory = reloaded.category_slug as string | null | undefined;

    await revalidateProductPaths(normalizedSlug, [previousCategory, nextCategory]);

    return {
      rowsAffected,
      product: mapRow(reloaded),
      previousCategory: previousCategory ?? null,
      found: true,
    };
  } finally {
    connection.release();
  }
}

export async function touchProductUpdatedAt(connection: PoolConnection, slug: string) {
  const table = getProductsTable();
  await connection.execute(`UPDATE ${table} SET last_tidb_update_at = NOW(6) WHERE slug = ?`, [
    normalizeSlug(slug),
  ]);
}

function buildUpdateAssignments(payload: ProductWritePayload, existing: RowDataPacket) {
  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const [key, config] of Object.entries(PRODUCT_COLUMNS) as [keyof typeof PRODUCT_COLUMNS, ColumnConfig][]) {
    const incoming = payload[key];
    if (incoming === undefined) {
      continue;
    }

    const sanitized = config.sanitizer ? config.sanitizer(incoming) : incoming;
    const normalized = normalizeValue(sanitized, config, key);
    const existingValue = existing[config.column];

    if (areValuesEqual(existingValue, normalized, config.type)) {
      continue;
    }

    assignments.push(`\`${config.column}\` = ?`);
    values.push(normalized);
  }

  return { assignments, values };
}

function normalizeSlug(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Slug is required for product updates.');
  }
  const normalized = value.trim();
  if (normalized.length > 191) {
    throw new Error('Slug exceeds maximum length of 191 characters.');
  }
  return normalized;
}

function normalizeValue(value: unknown, config: ColumnConfig, key: string) {
  if (value == null) {
    return null;
  }

  switch (config.type) {
    case 'number': {
      if (typeof value === 'number') {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      throw new Error(`Field ${key} must be a number.`);
    }
    case 'json': {
      return JSON.stringify(value);
    }
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
    default:
      return value;
  }
}

function normalizeHtml(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error('HTML fields must be strings.');
  }
  return value.replace(/\r\n/g, '\n').trim();
}

function normalizeUrl(value: unknown): string | null {
  if (value == null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error('URL fields must be strings.');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('URLs must start with http:// or https://');
  }
  return trimmed;
}

function normalizeStringArray(value: unknown): string[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('Expected an array of strings.');
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function areValuesEqual(current: unknown, next: unknown, type: ColumnConfig['type']) {
  if (current == null && next == null) {
    return true;
  }
  if (type === 'json') {
    try {
      const parsedCurrent = typeof current === 'string' ? JSON.parse(current) : current;
      const parsedNext = typeof next === 'string' ? JSON.parse(next) : next;
      return JSON.stringify(parsedCurrent) === JSON.stringify(parsedNext);
    } catch (_error) {
      return current === next;
    }
  }
  if (type === 'number') {
    return Number(current) === Number(next);
  }
  if (current instanceof Date && typeof next === 'string') {
    return current.toISOString() === next;
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

export async function fetchProductBySlug(slug: string) {
  const pool = getTiDbPool();
  const table = getProductsTable();
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT * FROM ${table} WHERE slug = ? LIMIT 1`, [
    normalizeSlug(slug),
  ]);
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function ensureProductExists(connection: Pool | PoolConnection, slug: string): Promise<boolean> {
  const table = getProductsTable();
  const [rows] = await connection.query<RowDataPacket[]>(`SELECT slug FROM ${table} WHERE slug = ? LIMIT 1`, [
    normalizeSlug(slug),
  ]);
  return rows.length > 0;
}
