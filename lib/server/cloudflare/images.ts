import 'server-only';

import { readBooleanEnv, readEnv } from '../env';

const API_BASE_URL = 'https://api.cloudflare.com/client/v4';

export interface CloudflareImagesConfig {
  enabled: boolean;
  accountId: string;
  token: string;
  baseUrl: string;
}

export interface CloudflareImagesResponse<T = unknown> {
  ok: boolean;
  status: number;
  rayId?: string;
  attempts: number;
  latencyMs: number;
  data?: T;
  error?: unknown;
}

export class MissingCloudflareImagesEnvError extends Error {
  constructor() {
    super('Cloudflare Images configuration is not available');
    this.name = 'MissingCloudflareImagesEnvError';
  }
}

export function getCloudflareImagesConfig(): CloudflareImagesConfig | null {
  const enabledFlag = readBooleanEnv('CF_IMAGES_ENABLED');
  if (enabledFlag !== true) {
    return null;
  }

  const accountId = readEnv('CF_IMAGES_ACCOUNT_ID');
  const token = readEnv('CF_IMAGES_TOKEN');
  const baseUrl = readEnv('CF_IMAGES_BASE_URL');

  if (!accountId || !token || !baseUrl) {
    return null;
  }

  return {
    enabled: true,
    accountId,
    token,
    baseUrl: normalizeCloudflareImagesBaseUrl(baseUrl),
  };
}

export function normalizeCloudflareImagesBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\s+/g, '');
  if (!trimmed) {
    return '';
  }
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

export function buildCloudflareDeliveryUrl(
  imageId: string,
  variant?: string
): string {
  const config = getCloudflareImagesConfig();
  if (!config) {
    throw new MissingCloudflareImagesEnvError();
  }

  const normalized = normalizeCloudflareImagesBaseUrl(config.baseUrl);
  const safeId = encodeURIComponent(imageId);
  const safeVariant = variant ? `/${encodeURIComponent(variant)}` : '';
  return `${normalized}/${safeId}${safeVariant}`;
}

interface RequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  timeoutMs?: number;
  retries?: number;
}

async function requestCloudflareApi<T>(
  config: CloudflareImagesConfig,
  path: string,
  options: RequestOptions = {}
): Promise<CloudflareImagesResponse<T>> {
  const url = `${API_BASE_URL}/accounts/${config.accountId}${path}`;
  const headers: HeadersInit = {
    Authorization: `Bearer ${config.token}`,
    ...(options.headers ?? {}),
  };

  const timeoutMs = options.timeoutMs ?? 20_000;
  const retries = options.retries ?? 1;

  let attempts = 0;
  let lastError: unknown;

  while (attempts <= retries) {
    attempts += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body ?? null,
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      const rayId = response.headers.get('cf-ray') ?? undefined;

      if (response.status >= 500 && attempts <= retries) {
        lastError = await safeParseJson(response);
        console.warn('cloudflare_images_retry', {
          attempt: attempts,
          status: response.status,
          account: obfuscateId(config.accountId),
          rayId,
        });
        clearTimeout(timeout);
        continue;
      }

      const data = await safeParseJson<T>(response);
      clearTimeout(timeout);
      return {
        ok: response.ok,
        status: response.status,
        data,
        rayId,
        attempts,
        latencyMs,
        error: response.ok ? undefined : data,
      };
    } catch (error) {
      lastError = error;
      clearTimeout(timeout);
      if (attempts > retries) {
        return {
          ok: false,
          status: 0,
          attempts,
          latencyMs: Date.now() - startedAt,
          error,
        };
      }
      console.warn('cloudflare_images_retry_error', {
        attempt: attempts,
        account: obfuscateId(config.accountId),
        error: (error as Error)?.message,
      });
    }
  }

  return {
    ok: false,
    status: 0,
    attempts,
    latencyMs: 0,
    error: lastError,
  };
}

async function safeParseJson<T>(response: Response): Promise<T | undefined> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return undefined;
  }
  try {
    return (await response.json()) as T;
  } catch (error) {
    console.warn('cloudflare_images_parse_error', {
      status: response.status,
      account: 'redacted',
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

export async function uploadCloudflareImage(
  formData: FormData,
  variant?: string
): Promise<CloudflareImagesResponse> {
  const config = getCloudflareImagesConfig();
  if (!config) {
    throw new MissingCloudflareImagesEnvError();
  }

  const path = variant ? `/images/v1?variant=${encodeURIComponent(variant)}` : '/images/v1';

  return requestCloudflareApi(config, path, {
    method: 'POST',
    body: formData,
  });
}

export async function deleteCloudflareImage(
  imageId: string
): Promise<CloudflareImagesResponse> {
  const config = getCloudflareImagesConfig();
  if (!config) {
    throw new MissingCloudflareImagesEnvError();
  }

  const path = `/images/v1/${encodeURIComponent(imageId)}`;

  return requestCloudflareApi(config, path, {
    method: 'DELETE',
  });
}

export async function testCloudflareImages(): Promise<CloudflareImagesResponse> {
  const config = getCloudflareImagesConfig();
  if (!config) {
    throw new MissingCloudflareImagesEnvError();
  }

  const result = await requestCloudflareApi<{ result?: unknown }>(
    config,
    '/images/v1?page=1&per_page=1',
    {
      method: 'GET',
    }
  );

  console.info('cloudflare_images_test', {
    ok: result.ok,
    status: result.status,
    rayId: result.rayId,
    attempts: result.attempts,
    latencyMs: result.latencyMs,
    account: obfuscateId(config.accountId),
  });

  return result;
}
