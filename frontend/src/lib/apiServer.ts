import { cookies } from 'next/headers';

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

const COOKIE_NAME = 'sorena_session';

export class ApiServerError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ApiServerError';
  }
}

async function serverRequest<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const cookieStore = cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
    cache: 'no-store',
  });

  const data = await res
    .json()
    .catch(() => ({ message: 'Request failed.' }));

  if (!res.ok) {
    throw new ApiServerError(
      res.status,
      data?.message || 'Something went wrong.',
    );
  }

  return data as T;
}

export const apiServer = {
  get: <T>(path: string) => serverRequest<T>(path, { method: 'GET' }),
  post: <T>(path: string, body: unknown) =>
    serverRequest<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    serverRequest<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
};
