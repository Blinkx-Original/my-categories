import 'server-only';

import { readEnv } from '../env';

export type TiDbSslMode = 'disable' | 'skip-verify' | 'verify-ca' | 'verify-full';

export interface TiDbCredentials {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  sslMode: TiDbSslMode;
  ca?: string;
  serverName?: string;
}

export interface TiDbProductMetricsConfig {
  table: string;
  lastmodColumn: string;
  whereClause?: string;
}

export function loadTiDbCredentials(): TiDbCredentials | null {
  const host = readEnv('TIDB_HOST');
  const port = readEnv('TIDB_PORT');
  const user = readEnv('TIDB_USER');
  const password = readEnv('TIDB_PASSWORD');
  const database = readEnv('TIDB_DATABASE');

  if (!host || !port || !user || !password || !database) {
    return null;
  }

  const sslMode = (readEnv('TIDB_SSL_MODE') as TiDbSslMode | undefined) ?? 'skip-verify';
  const sslCa = decodeCertificate(readEnv('TIDB_SSL_CA'));
  const serverName = readEnv('TIDB_SSL_SERVER_NAME');

  return {
    host,
    port: Number.parseInt(port, 10),
    user,
    password,
    database,
    sslMode,
    ca: sslCa ?? undefined,
    serverName: serverName ?? undefined,
  };
}

export function loadTiDbProductMetricsConfig(): TiDbProductMetricsConfig {
  return {
    table: readEnv('TIDB_PRODUCTS_TABLE') ?? 'products',
    lastmodColumn: readEnv('TIDB_PRODUCTS_LASTMOD_COLUMN') ?? 'updated_at',
    whereClause: readEnv('TIDB_PRODUCTS_PUBLISHED_WHERE') ?? undefined,
  };
}

function decodeCertificate(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }
  if (value.includes('BEGIN CERTIFICATE')) {
    return value.replace(/\\n/g, '\n');
  }
  try {
    return Buffer.from(value, 'base64').toString('utf-8');
  } catch (_error) {
    return value.replace(/\\n/g, '\n');
  }
}

export interface PrismaConnectionOptions {
  url: string;
  directUrl?: string;
}

export function buildPrismaConnectionOptions(credentials: TiDbCredentials): PrismaConnectionOptions {
  const baseUrl = new URL(
    `mysql://${encodeURIComponent(credentials.user)}:${encodeURIComponent(credentials.password)}@${credentials.host}:${credentials.port}/${credentials.database}`
  );

  applySslParameters(baseUrl, credentials);

  return {
    url: baseUrl.toString(),
  };
}

function applySslParameters(url: URL, credentials: TiDbCredentials) {
  const params = url.searchParams;
  params.set('connection_limit', '5');

  switch (credentials.sslMode) {
    case 'disable':
      params.set('sslaccept', 'disabled');
      break;
    case 'skip-verify':
      params.set('sslaccept', 'accept_invalid_certs');
      break;
    case 'verify-ca':
      params.set('sslaccept', 'verify_ca');
      if (credentials.ca) {
        params.set('sslcert', Buffer.from(credentials.ca).toString('base64'));
      }
      break;
    case 'verify-full':
      params.set('sslaccept', 'verify_full');
      if (credentials.ca) {
        params.set('sslcert', Buffer.from(credentials.ca).toString('base64'));
      }
      if (credentials.serverName) {
        params.set('servername', credentials.serverName);
      } else {
        params.set('servername', credentials.host);
      }
      break;
    default:
      params.set('sslaccept', 'accept_invalid_certs');
  }
}
