import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';

const COOKIE_NAME = 'sorena_session';

export interface Session {
  userId: string;
  role: string;
  // Secondary roles WIDEN access only — they never change `role` (routing/badge
  // still use `role`). Sourced from the JWT payload; empty for most users.
  secondaryRoles: string[];
  email: string;
  name: string;
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    // PR-AUDIT-2 — fail-fast if JWT_SECRET is missing. The literal
    // 'fallback_secret' default that used to be here meant a missing
    // Vercel env var produced a guessable verifier — removed so a
    // misconfigured deploy throws instead of accepting forged tokens.
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new Error('JWT_SECRET is not set');
    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secret);
    return {
      userId: (payload.sub as string) ?? '',
      role: (payload.role as string) ?? '',
      secondaryRoles: (payload.secondaryRoles as string[]) ?? [],
      email: (payload.email as string) ?? '',
      name: (payload.name as string) ?? (payload.email as string) ?? 'User',
    };
  } catch {
    return null;
  }
}

export { COOKIE_NAME };
