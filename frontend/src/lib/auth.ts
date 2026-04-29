import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';

const COOKIE_NAME = 'sorena_session';

export interface Session {
  userId: string;
  role: string;
  email: string;
  name: string;
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET || 'fallback_secret',
    );
    const { payload } = await jwtVerify(token, secret);
    return {
      userId: (payload.sub as string) ?? '',
      role: (payload.role as string) ?? '',
      email: (payload.email as string) ?? '',
      name: (payload.name as string) ?? (payload.email as string) ?? 'User',
    };
  } catch {
    return null;
  }
}

export { COOKIE_NAME };
