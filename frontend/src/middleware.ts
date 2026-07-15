import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { hasRole } from '@/lib/roles';

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
    // PR-AUDIT-2 — fail-fast if JWT_SECRET is missing. Edge runtime,
    // so the throw propagates to the catch below and bounces the
    // user to /login (no silent fallback to a guessable verifier).
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new Error('JWT_SECRET is not set');
    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secret);
    const role = payload.role as string;
    const secondaryRoles = (payload.secondaryRoles as string[] | undefined) ?? [];

    // Widen with secondary roles: allowed if the PRIMARY role OR any secondary
    // role is in the route's allowed set. Never narrows (empty → old check).
    if (!hasRole(role, secondaryRoles, ROLE_ROUTES[protectedBase])) {
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
