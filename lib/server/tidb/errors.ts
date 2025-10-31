import 'server-only';

import { Prisma } from '@prisma/client';

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
