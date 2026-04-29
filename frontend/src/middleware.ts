import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const ROLE_ROUTES: Record<string, string[]> = {
  '/admin':   ['SUPER_ADMIN', 'ADMIN'],
  '/ops':     ['OPERATIONS', 'SUPER_ADMIN', 'ADMIN'],
  '/sales':   ['SALES', 'SUPER_ADMIN', 'ADMIN'],
  '/lia':     ['LIA', 'SUPER_ADMIN', 'ADMIN'],
  '/student': ['SUPER_ADMIN', 'ADMIN', 'SALES', 'OPERATIONS', 'LIA', 'SUPPORT'],
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
  matcher: ['/admin/:path*', '/ops/:path*', '/sales/:path*', '/lia/:path*', '/student/:path*'],
};
