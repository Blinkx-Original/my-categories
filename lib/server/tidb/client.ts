import 'server-only';

import { PrismaClient } from '@prisma/client';

import { buildPrismaConnectionOptions, loadTiDbCredentials } from './config';

declare global {
  // eslint-disable-next-line no-var
  var __tiDbPrisma: PrismaClient | undefined;
}

export function getPrismaClient(): PrismaClient {
  if (process.env.NODE_ENV !== 'production') {
    if (!global.__tiDbPrisma) {
      global.__tiDbPrisma = instantiateClient();
    }
    return global.__tiDbPrisma;
  }

  return instantiateClient();
}

function instantiateClient(): PrismaClient {
  const credentials = loadTiDbCredentials();
  if (!credentials) {
    throw new Error('missing TiDB environment configuration');
  }

  const connection = buildPrismaConnectionOptions(credentials);

  return new PrismaClient({
    datasources: {
      db: {
        url: connection.url,
      },
    },
  });
}
