import { cookies } from 'next/headers';
import { COOKIE_NAME } from '@/lib/auth';

export async function GET() {
  const token = cookies().get(COOKIE_NAME)?.value ?? null;
  return Response.json({ token });
}
