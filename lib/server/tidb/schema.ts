import 'server-only';

import { readEnv } from '../env';

export function getProductsTable(): string {
  const override = readEnv('TIDB_PRODUCTS_TABLE');
  return quoteIdentifier(override ?? 'products');
}

export function getPostsTable(): string {
  const override = readEnv('TIDB_POSTS_TABLE');
  return quoteIdentifier(override ?? 'posts');
}

export function getCategoriesTable(): string {
  const override = readEnv('TIDB_CATEGORIES_TABLE');
  return quoteIdentifier(override ?? 'categories');
}

function quoteIdentifier(value: string): string {
  const parts = value
    .split('.')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error(`Invalid identifier: ${value}`);
  }
  for (const part of parts) {
    if (!/^[A-Za-z0-9_]+$/.test(part)) {
      throw new Error(`Invalid identifier segment: ${part}`);
    }
  }
  return parts.map((part) => `\`${part}\``).join('.');
}
