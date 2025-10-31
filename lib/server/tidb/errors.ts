import 'server-only';

import { Prisma } from '@prisma/client';
import type { QueryError } from 'mysql2';

export type DbErrorCode = 'timeout' | 'auth_failed' | 'sql_error' | 'unknown';

export interface DbErrorInfo {
  code: DbErrorCode;
  message: string;
  sqlState?: string;
}

export function toDbErrorInfo(error: unknown): DbErrorInfo {
  if (!error) {
    return { code: 'unknown', message: 'Unknown database error' };
  }

  if (isMysqlError(error)) {
    return normalizeMysqlError(error);
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return normalizeInitializationError(error);
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return {
      code: 'sql_error',
      message: error.message,
      sqlState: error.meta?.sqlState as string | undefined,
    };
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return categorizeByMessage(error.message);
  }

  if (error instanceof Prisma.PrismaClientRustPanicError) {
    return { code: 'unknown', message: 'Prisma engine panic' };
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return { code: 'sql_error', message: error.message };
  }

  const message = (error as Error)?.message ?? String(error);
  return categorizeByMessage(message, error as { code?: string; sqlState?: string });
}

function isMysqlError(error: unknown): error is QueryError {
  if (!error || typeof error !== 'object') {
    return false;
  }
  return (
    typeof (error as QueryError).code === 'string' ||
    typeof (error as QueryError).sqlState === 'string' ||
    typeof (error as QueryError).fatal === 'boolean'
  );
}

function normalizeMysqlError(error: QueryError): DbErrorInfo {
  const message = error.message ?? 'MySQL error';
  const code = error.code ?? '';
  const lower = message.toLowerCase();

  if (
    code === 'ETIMEDOUT' ||
    code === 'PROTOCOL_SEQUENCE_TIMEOUT' ||
    code === 'PROTOCOL_CONNECTION_LOST' ||
    code === 'ECONNRESET' ||
    lower.includes('timeout') ||
    lower.includes('timed out')
  ) {
    return { code: 'timeout', message, sqlState: error.sqlState };
  }

  if (
    code === 'ER_ACCESS_DENIED_ERROR' ||
    code === 'ER_DBACCESS_DENIED_ERROR' ||
    lower.includes('access denied') ||
    lower.includes('permission')
  ) {
    return { code: 'auth_failed', message, sqlState: error.sqlState };
  }

  if (code && code.startsWith('ER_')) {
    return { code: 'sql_error', message, sqlState: error.sqlState };
  }

  return categorizeByMessage(message, { code, sqlState: error.sqlState });
}

function normalizeInitializationError(error: Prisma.PrismaClientInitializationError): DbErrorInfo {
  const lower = error.message.toLowerCase();
  if (lower.includes('access denied') || lower.includes('authentication')) {
    return { code: 'auth_failed', message: error.message };
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return { code: 'timeout', message: error.message };
  }
  return { code: 'unknown', message: error.message };
}

function categorizeByMessage(
  message: string,
  meta?: { code?: string; sqlState?: string }
): DbErrorInfo {
  const lower = message.toLowerCase();

  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('connection lost')) {
    return { code: 'timeout', message };
  }

  if (lower.includes('access denied') || lower.includes('permission')) {
    return { code: 'auth_failed', message };
  }

  if (meta?.sqlState || meta?.code === 'ER_PARSE_ERROR') {
    return { code: 'sql_error', message, sqlState: meta.sqlState };
  }

  return { code: 'unknown', message };
}
