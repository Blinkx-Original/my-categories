import 'server-only';

import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSessionCookie,
  issueAdminSessionToken as issueToken,
  verifyAdminSessionToken as verifyToken,
} from '@/lib/admin/auth';

import { readEnv } from '../env';

export { ADMIN_COOKIE_NAME, ADMIN_SESSION_TTL_SECONDS, createAdminSessionCookie } from '@/lib/admin/auth';

export interface AdminAuthConfig {
  password: string;
}

export function getAdminAuthConfig(): AdminAuthConfig | null {
  const password = readEnv('ADMIN_PASSWORD');
  if (!password) {
    return null;
  }

  return { password };
}

export async function issueAdminSessionToken(
  config: AdminAuthConfig,
  issuedAt = Date.now()
): Promise<string> {
  return issueToken(config.password, issuedAt);
}

export async function verifyAdminSessionToken(
  token: string,
  config: AdminAuthConfig,
  now = Date.now()
): Promise<boolean> {
  return verifyToken(token, config.password, now);
}
