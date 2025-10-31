import 'server-only';

import type { NextRequest } from 'next/server';

import { readBooleanEnv, readEnv } from '../env';

const API_BASE_URL = 'https://api.cloudflare.com/client/v4';
const MAX_URLS_PER_REQUEST = 2000;

export interface CloudflarePurgeConfig {
  zoneId: string;
  apiToken: string;
  enablePurgeOnPublish: boolean;
  includeProductUrls: boolean;
}

export interface PurgeResult {
  ok: boolean;
  status: number;
  rayIds: string[];
  latencyMs: number;
  attempts: number;
  mode: 'files' | 'purge_everything';
  error?: unknown;
}

export class MissingCloudflarePurgeEnvError extends Error {
  constructor() {
    super('Cloudflare purge configuration is not available');
    this.name = 'MissingCloudflarePurgeEnvError';
  }
}

export class MissingSiteUrlError extends Error {
  constructor() {
    super('Unable to resolve site URL for purge operation');
    this.name = 'MissingSiteUrlError';
  }
}

export function getCloudflarePurgeConfig(): CloudflarePurgeConfig | null {
  const zoneId = readEnv('CLOUDFLARE_ZONE_ID');
  const apiToken = readEnv('CLOUDFLARE_API_TOKEN');
  if (!zoneId || !apiToken) {
    return null;
  }

  const enablePurgeOnPublish = readBooleanEnv('CLOUDFLARE_ENABLE_PURGE_ON_PUBLISH') ?? false;
  const includeProductUrls = readBooleanEnv('CLOUDFLARE_INCLUDE_PRODUCT_URLS') ?? false;

  return {
    zoneId,
    apiToken,
    enablePurgeOnPublish,
    includeProductUrls,
  };
}

export function resolveSiteUrl(request?: NextRequest): string {
  const explicitUrl = readEnv('NEXT_PUBLIC_SITE_URL');
  if (request) {
    const origin = request.headers.get('x-forwarded-host')
      ? `${request.headers.get('x-forwarded-proto') ?? 'https'}://${request.headers.get('x-forwarded-host')}`
      : request.nextUrl?.origin;
    if (origin) {
      return origin.replace(/\/$/, '');
    }
  }
  if (explicitUrl) {
    return explicitUrl.replace(/\/$/, '');
  }
  throw new MissingSiteUrlError();
}

export function buildSitemapUrls(baseUrl: string): string[] {
  const normalized = baseUrl.replace(/\/$/, '');
  return [`${normalized}/sitemap.xml`, `${normalized}/sitemap-products.xml`];
}

export function buildProductUrls(baseUrl: string, slugs: string[]): string[] {
  const normalized = baseUrl.replace(/\/$/, '');
  return slugs.map((slug) => `${normalized}/p/${encodeURIComponent(slug)}`);
}

function chunkUrls(urls: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < urls.length; i += MAX_URLS_PER_REQUEST) {
    chunks.push(urls.slice(i, i + MAX_URLS_PER_REQUEST));
  }
  return chunks;
}

interface PurgeRequestOptions {
  timeoutMs?: number;
  retryOnTimeout?: boolean;
}

async function purgeChunk(
  config: CloudflarePurgeConfig,
  urls: string[],
  options: PurgeRequestOptions = {}
): Promise<PurgeResult> {
  const timeoutMs = options.timeoutMs ?? 25_000;
  const url = `${API_BASE_URL}/zones/${config.zoneId}/purge_cache`;
  let attempts = 0;
  const rayIds: string[] = [];

  while (attempts < 2) {
    attempts += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ files: urls }),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      const rayId = response.headers.get('cf-ray') ?? undefined;
      if (rayId) {
        rayIds.push(rayId);
      }

      if ((response.status >= 500 || response.status === 524) && attempts < 2) {
        console.warn('cloudflare_purge_retry', {
          attempt: attempts,
          status: response.status,
          zone: obfuscateId(config.zoneId),
          rayId,
        });
        clearTimeout(timeout);
        continue;
      }

      const data = await safeParseJson(response);
      clearTimeout(timeout);

      const result: PurgeResult = {
        ok: response.ok,
        status: response.status,
        rayIds,
        attempts,
        latencyMs,
        mode: 'files',
        error: response.ok ? undefined : data,
      };

      console.info('cloudflare_purge', {
        ok: result.ok,
        status: result.status,
        rayIds,
        attempts,
        latencyMs,
        zone: obfuscateId(config.zoneId),
      });

      return result;
    } catch (error) {
      clearTimeout(timeout);
      const latencyMs = Date.now() - startedAt;
      const isAbort = (error as Error)?.name === 'AbortError';
      if (attempts < 2 && isAbort && options.retryOnTimeout) {
        console.warn('cloudflare_purge_timeout_retry', {
          attempt: attempts,
          zone: obfuscateId(config.zoneId),
          error: (error as Error)?.message,
        });
        continue;
      }

      console.error('cloudflare_purge_failed', {
        zone: obfuscateId(config.zoneId),
        attempts,
        error: (error as Error)?.message,
      });

      return {
        ok: false,
        status: 0,
        rayIds,
        attempts,
        latencyMs,
        mode: 'files',
        error,
      };
    }
  }

  return {
    ok: false,
    status: 0,
    rayIds,
    attempts: 2,
    latencyMs: 0,
    mode: 'files',
    error: new Error('Failed to purge Cloudflare cache'),
  };
}

export async function purgeCloudflareUrls(
  urls: string[],
  config = getCloudflarePurgeConfig()
): Promise<PurgeResult[]> {
  if (!config) {
    throw new MissingCloudflarePurgeEnvError();
  }

  const chunks = chunkUrls(urls);
  const results: PurgeResult[] = [];

  for (const chunk of chunks) {
    const result = await purgeChunk(config, chunk, { retryOnTimeout: true });
    results.push(result);
  }

  return results;
}

export async function purgeOnPublish(options: {
  request?: NextRequest;
  productSlugs?: string[];
  additionalUrls?: string[];
  config?: CloudflarePurgeConfig | null;
}): Promise<PurgeResult[] | null> {
  const config = options.config ?? getCloudflarePurgeConfig();
  if (!config || !config.enablePurgeOnPublish) {
    return null;
  }

  const siteUrl = resolveSiteUrl(options.request);
  const urls = new Set<string>([
    ...buildSitemapUrls(siteUrl),
    ...(options.additionalUrls ?? []),
  ]);

  if (config.includeProductUrls) {
    for (const url of buildProductUrls(siteUrl, options.productSlugs ?? [])) {
      urls.add(url);
    }
  }

  const result = await purgeCloudflareUrls(Array.from(urls), config);
  return result;
}

async function safeParseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return undefined;
  }
  try {
    return await response.json();
  } catch (error) {
    console.warn('cloudflare_purge_parse_error', {
      zone: 'redacted',
      error: (error as Error)?.message,
    });
    return undefined;
  }
}

function obfuscateId(id: string): string {
  if (id.length <= 6) {
    return id;
  }
  return `${id.slice(0, 2)}…${id.slice(-2)}`;
}
