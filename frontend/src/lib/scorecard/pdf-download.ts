// PR-SCORECARD-3 — Client-side PDF download helper.
//
// Both the client-facing result page and the staff scorecard detail
// page call this to trigger a native browser download. It handles:
//   1. Resolving the API URL from env (matching lib/api.ts conventions).
//   2. Reading the same /api/auth/token endpoint as `api` to fetch
//      the JWT (the API client caches it module-globally; we don't
//      want to duplicate that cache here, so we route through it).
//   3. Calling the endpoint with credentials + Authorization header.
//   4. Parsing Content-Disposition for the server-suggested filename,
//      falling back to the caller's suggestion.
//   5. Programmatically clicking an anchor to trigger the download.

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

async function getToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/token', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data: { token: string | null } = await res.json();
    return data.token ?? null;
  } catch {
    return null;
  }
}

function parseFilename(header: string | null): string | null {
  if (!header) return null;
  // Match `filename="…"` first, then bare `filename=…`.
  const quoted = header.match(/filename\*?="([^"]+)"/i);
  if (quoted) return quoted[1];
  const bare = header.match(/filename\*?=([^;]+)/i);
  if (bare) return bare[1].trim();
  return null;
}

export async function downloadPdf(
  endpoint: string,
  suggestedFilename: string,
): Promise<void> {
  const token = await getToken();
  const res = await fetch(`${API_URL}${endpoint}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) {
    let message = `PDF request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) message = body.message;
    } catch { /* non-JSON error body — keep generic message */ }
    throw new Error(message);
  }

  const blob = await res.blob();
  const filename = parseFilename(res.headers.get('content-disposition')) ?? suggestedFilename;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // Anchor must be in the DOM for Firefox to honour the .click().
  document.body.appendChild(a);
  a.click();
  // Defer cleanup so the click handler completes before we revoke
  // the blob URL.
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
}
