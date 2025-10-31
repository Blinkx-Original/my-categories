import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import {
  ADMIN_COOKIE_NAME,
  createAdminSessionCookie,
  issueAdminSessionToken,
  verifyAdminSessionToken,
} from '@/lib/admin/auth';

const AUTH_REALM = 'Virtual Product Pages Admin';

function needsAdminAuth(pathname: string): boolean {
  if (pathname === '/admin') {
    return true;
  }

  return pathname.startsWith('/admin/') || pathname.startsWith('/api/admin');
}

function readAdminPassword(): string | null {
  const raw = process.env.ADMIN_PASSWORD;
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function unauthorizedResponse(message: string, status = 401) {
  return new NextResponse(message, {
    status,
    headers: {
      'WWW-Authenticate': `Basic realm="${AUTH_REALM}", charset="UTF-8"`,
    },
  });
}

function getBearerToken(header: string | null | undefined): string | null {
  if (!header) {
    return null;
  }
  if (!header.startsWith('Bearer ')) {
    return null;
  }
  return header.slice('Bearer '.length).trim();
}

function decodeBase64(input: string): string | null {
  try {
    if (typeof atob === 'function') {
      return atob(input);
    }
  } catch (_error) {
    return null;
  }
  return null;
}

function parseBasicCredentials(header: string): { user: string; password: string } | null {
  const encoded = header.slice('Basic '.length).trim();
  if (!encoded) {
    return null;
  }
  const decoded = decodeBase64(encoded);
  if (!decoded) {
    return null;
  }
  const separator = decoded.indexOf(':');
  if (separator === -1) {
    return null;
  }
  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  return { user, password };
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!needsAdminAuth(pathname)) {
    return NextResponse.next();
  }

  const password = readAdminPassword();
  if (!password) {
    return new NextResponse('Admin password not configured', { status: 503 });
  }

  const cookieToken = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (cookieToken && (await verifyAdminSessionToken(cookieToken, password))) {
    return NextResponse.next();
  }

  const authHeader = request.headers.get('authorization');
  const bearerToken = getBearerToken(authHeader);
  if (bearerToken && (await verifyAdminSessionToken(bearerToken, password))) {
    return NextResponse.next();
  }

  if (authHeader?.startsWith('Basic ')) {
    const credentials = parseBasicCredentials(authHeader);
    if (!credentials) {
      return unauthorizedResponse('Invalid credentials');
    }
    if (credentials.user !== 'admin' || credentials.password !== password) {
      return unauthorizedResponse('Invalid credentials');
    }

    const response = NextResponse.next();
    const token = await issueAdminSessionToken(password);
    const cookie = createAdminSessionCookie(token);
    response.cookies.set(cookie);
    response.headers.set('cache-control', 'no-store');
    return response;
  }

  const response = unauthorizedResponse('Authentication required');
  response.cookies.delete({ name: ADMIN_COOKIE_NAME, path: '/' });
  return response;
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
