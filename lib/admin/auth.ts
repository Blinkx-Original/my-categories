const encoder = new TextEncoder();

export const ADMIN_COOKIE_NAME = 'vpp-admin-auth';
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;

function getCrypto(): Crypto {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error('Crypto API is not available in this runtime');
  }
  return globalThis.crypto;
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let output = '';
  for (let i = 0; i < bytes.length; i += 1) {
    output += bytes[i].toString(16).padStart(2, '0');
  }
  return output;
}

function getBuffer() {
  return (globalThis as unknown as {
    Buffer?: {
      from(input: string, encoding: string): { toString(encoding: string): string };
    };
  }).Buffer;
}

function toBase64Url(value: string): string {
  if (typeof btoa === 'function') {
    return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
  }
  const buffer = getBuffer();
  if (buffer) {
    return buffer
      .from(value, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/u, '');
  }
  throw new Error('Base64 encoding not supported');
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  if (typeof atob === 'function') {
    return atob(padded);
  }
  const buffer = getBuffer();
  if (buffer) {
    return buffer.from(padded, 'base64').toString('utf8');
  }
  throw new Error('Base64 decoding not supported');
}

function timingSafeEqual(expected: string, provided: string): boolean {
  if (expected.length !== provided.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < expected.length; i += 1) {
    result |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return result === 0;
}

function randomNonce(): string {
  const array = new Uint8Array(16);
  getCrypto().getRandomValues(array);
  let output = '';
  for (let i = 0; i < array.length; i += 1) {
    output += array[i].toString(16).padStart(2, '0');
  }
  return output;
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const crypto = getCrypto();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return bufferToHex(signature);
}

export async function issueAdminSessionToken(
  password: string,
  issuedAt = Date.now()
): Promise<string> {
  const nonce = randomNonce();
  const payload = `${issuedAt}:${nonce}`;
  const signature = await signPayload(payload, password);
  const raw = `${payload}:${signature}`;
  return toBase64Url(raw);
}

export async function verifyAdminSessionToken(
  token: string,
  password: string,
  now = Date.now()
): Promise<boolean> {
  try {
    const decoded = fromBase64Url(token);
    const [issuedAtRaw, nonce, signature] = decoded.split(':');
    if (!issuedAtRaw || !nonce || !signature) {
      return false;
    }

    const payload = `${issuedAtRaw}:${nonce}`;
    const expected = await signPayload(payload, password);
    if (!timingSafeEqual(expected, signature)) {
      return false;
    }

    const issuedAt = Number.parseInt(issuedAtRaw, 10);
    if (Number.isNaN(issuedAt)) {
      return false;
    }

    const age = now - issuedAt;
    if (age < 0 || age > ADMIN_SESSION_TTL_SECONDS * 1000) {
      return false;
    }

    return true;
  } catch (_error) {
    return false;
  }
}

export function createAdminSessionCookie(token: string) {
  return {
    name: ADMIN_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax' as const,
    maxAge: ADMIN_SESSION_TTL_SECONDS,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
}
