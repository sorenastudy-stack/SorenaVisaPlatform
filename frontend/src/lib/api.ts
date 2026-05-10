const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// Cache the JWT for the lifetime of the browser session.
// Populated on first API call via /api/auth/token (reads the httpOnly cookie server-side).
// Module-level state is per-browser-tab; a full-page navigation (e.g. logout redirect) resets it.
let _token: string | null | undefined = undefined;

async function getToken(): Promise<string | null> {
  if (_token !== undefined) return _token;
  try {
    const res = await fetch('/api/auth/token', { credentials: 'same-origin' });
    const data: { token: string | null } = await res.json();
    _token = data.token ?? null;
  } catch {
    _token = null;
  }
  return _token;
}

export function invalidateTokenCache(): void {
  _token = undefined;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({ message: 'Request failed.' }));

  if (!res.ok) {
    throw new ApiError(res.status, data?.message || 'Something went wrong. Please try again.');
  }

  return data as T;
}

export const api = {
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) =>
    request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, body: FormData): Promise<T> =>
    getToken().then(token =>
      fetch(`${API_URL}${path}`, {
        method: 'POST',
        credentials: 'include',
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        body,
        // no Content-Type header — browser sets multipart/form-data + boundary automatically
      })
    ).then(async (res) => {
      const data = await res.json().catch(() => ({ message: 'Request failed.' }));
      if (!res.ok) throw new ApiError(res.status, data?.message ?? 'Something went wrong.');
      return data as T;
    }),
};
