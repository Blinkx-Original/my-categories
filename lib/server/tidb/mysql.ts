import 'server-only';

import type { Pool, PoolConnection } from 'mysql2/promise';
import { createPool } from 'mysql2/promise';

import type { TiDbCredentials } from './config';
import { loadTiDbCredentials } from './config';

declare global {
  // eslint-disable-next-line no-var
  var __tiDbPool: Pool | undefined;
}

export function getTiDbPool(): Pool {
  if (process.env.NODE_ENV !== 'production' && global.__tiDbPool) {
    return global.__tiDbPool;
  }

  const credentials = loadTiDbCredentials();
  if (!credentials) {
    throw new Error('missing TiDB environment configuration');
  }

  const pool = createPool(buildPoolOptions(credentials));

  if (process.env.NODE_ENV !== 'production') {
    global.__tiDbPool = pool;
  }

  return pool;
}

export async function runInTransaction<T>(callback: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const pool = getTiDbPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('tidb_transaction_rollback_failed', {
        error: (rollbackError as Error)?.message,
      });
    }
    throw error;
  } finally {
    connection.release();
  }
}

function buildPoolOptions(credentials: TiDbCredentials) {
  const ssl = buildSslOptions(credentials);

  return {
    host: credentials.host,
    port: credentials.port,
    user: credentials.user,
    password: credentials.password,
    database: credentials.database,
    waitForConnections: true,
    connectionLimit: 10,
    maxIdle: 5,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    connectTimeout: 15_000,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    namedPlaceholders: false,
    ssl,
  } as const;
}

function buildSslOptions(credentials: TiDbCredentials) {
  switch (credentials.sslMode) {
    case 'disable':
      return undefined;
    case 'skip-verify':
      return {
        rejectUnauthorized: false,
      } as const;
    case 'verify-ca':
      return {
        rejectUnauthorized: true,
        ca: credentials.ca,
      } as const;
    case 'verify-full':
      return {
        rejectUnauthorized: true,
        ca: credentials.ca,
        servername: credentials.serverName ?? credentials.host,
      } as const;
    default:
      return {
        rejectUnauthorized: false,
      } as const;
  }
}
