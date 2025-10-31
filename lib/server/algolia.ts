import 'server-only';

import algoliasearch, { type SearchClient } from 'algoliasearch';

import { readEnv } from './env';

export interface AlgoliaConfig {
  appId: string;
  apiKey: string;
  indexName: string;
}

export class MissingAlgoliaEnvError extends Error {
  constructor() {
    super('Algolia configuration is not available');
    this.name = 'MissingAlgoliaEnvError';
  }
}

export class AlgoliaTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlgoliaTimeoutError';
  }
}

export function getAlgoliaConfig(): AlgoliaConfig | null {
  const appId = readEnv('ALGOLIA_APP_ID');
  const apiKey = readEnv('ALGOLIA_ADMIN_API_KEY') ?? readEnv('ALGOLIA_API_KEY');
  const indexName = readEnv('ALGOLIA_INDEX_PRIMARY') ?? readEnv('ALGOLIA_INDEX');

  if (!appId || !apiKey || !indexName) {
    return null;
  }

  return { appId, apiKey, indexName };
}

export function createAlgoliaClient(config = getAlgoliaConfig()): SearchClient {
  if (!config) {
    throw new MissingAlgoliaEnvError();
  }
  return algoliasearch(config.appId, config.apiKey);
}

export async function listAlgoliaIndices(
  client: SearchClient,
  timeoutMs = 5000
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await client.listIndices({
      requestOptions: { signal: controller.signal },
    });
    return response;
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      throw new AlgoliaTimeoutError(`Algolia request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyAlgoliaIndex(
  config = getAlgoliaConfig(),
  timeoutMs = 5000
) {
  if (!config) {
    throw new MissingAlgoliaEnvError();
  }

  const client = createAlgoliaClient(config);
  const startedAt = Date.now();

  try {
    const indices = await listAlgoliaIndices(client, timeoutMs);
    const latencyMs = Date.now() - startedAt;
    const exists =
      indices.items?.some(
        (item: { name: string }) => item.name === config.indexName
      ) ?? false;

    if (!exists) {
      return {
        ok: false,
        latencyMs,
        errorCode: 'index_not_found' as const,
      };
    }

    return {
      ok: true,
      latencyMs,
    };
  } catch (error) {
    const info = normalizeAlgoliaError(error);
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      errorCode: info.code,
      errorMessage: info.message,
    };
  }
}

function normalizeAlgoliaError(error: unknown): { code: string; message: string } {
  if (error instanceof AlgoliaTimeoutError) {
    return { code: 'timeout', message: error.message };
  }

  const status = (error as { status?: number })?.status;
  if (status === 401 || status === 403) {
    return { code: 'auth_failed', message: 'Algolia credentials were rejected' };
  }

  return {
    code: 'unknown',
    message: (error as Error)?.message ?? 'Unknown Algolia error',
  };
}
