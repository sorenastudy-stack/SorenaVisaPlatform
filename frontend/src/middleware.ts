import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

// PR-CONSULT-2 — `/staff/*` is the new combined staff portal that
// replaces the per-role `/admin`, `/ops`, `/sales`, `/lia` shells
// going forward. All 7 staff roles (OWNER / SUPER_ADMIN / ADMIN /
// LIA / CONSULTANT / SUPPORT / FINANCE) can reach `/staff`.
const ROLE_ROUTES: Record<string, string[]> = {
  '/admin':   ['ADMIN', 'SUPER_ADMIN', 'OWNER'],
  '/ops':     ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN', 'OWNER'],
  '/sales':   ['SALES', 'ADMIN', 'SUPER_ADMIN', 'OWNER'],
  '/lia':     ['LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER'],
  '/staff':   ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE'],
  '/student': ['STUDENT'],
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const protectedBase = Object.keys(ROLE_ROUTES).find((p) =>
    pathname === p || pathname.startsWith(p + '/'),
  );
  if (!protectedBase) return NextResponse.next();

  const token = request.cookies.get('sorena_session')?.value;
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET || 'fallback_secret',
    );
    const { payload } = await jwtVerify(token, secret);
    const role = payload.role as string;

    if (!ROLE_ROUTES[protectedBase].includes(role)) {
      return NextResponse.redirect(new URL('/unauthorized', request.url));
    }

    return NextResponse.next();
  } catch {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/ops/:path*',
    '/sales/:path*',
    '/lia/:path*',
    '/staff/:path*',
    '/student/:path*',
  ],
};
