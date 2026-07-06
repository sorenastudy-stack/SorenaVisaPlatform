# CORS Fix — allow the live domain (www.sorenavisa.com) to reach the API

**Launch blocker:** the backend CORS allowlist hardcodes `https://app.sorenavisa.com`,
but the real production domain is **`www.sorenavisa.com`**. Since CORS matches the
browser's exact origin, the live site would be **blocked from calling its own API** —
nothing would load for a real client.

**Good news:** the fix is a **production env-var change, not a code change** — the
allowlist already appends an `ALLOWED_ORIGINS` env variable. This document reports the
current state and the exact recommended fix. **No code was changed.**

---

## 1. Where CORS is configured + the exact current allowlist

Configured **inline in `backend/src/main.ts`** (lines ~61–81, inside `bootstrap()`),
**not** a separate config file.

Current effective allowed origins:

```
http://localhost:3000
http://localhost:3001
http://localhost:3002
https://app.sorenavisa.com
https://ample-dream-production-1005.up.railway.app
+ any comma-separated entries from the ALLOWED_ORIGINS env var
```

Relevant code (`backend/src/main.ts`):

```ts
const extraOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').filter(s => s.trim()).map(s => s.trim());
const allowAll = extraOrigins.includes('*');
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'https://app.sorenavisa.com',
  'https://ample-dream-production-1005.up.railway.app',
  ...extraOrigins.filter(s => s !== '*'),
];
app.enableCors({
  origin: (origin, callback) => {
    if (allowAll || !origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'), false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
});
```

Notes:
- Matching is **exact-string** on scheme + host (no trailing slash, `https` explicit).
- `credentials: true` is set (cookies/Authorization are sent cross-origin).
- If `ALLOWED_ORIGINS` contains `*`, it flips to **allow-all** (`allowAll`).
- **`https://www.sorenavisa.com` is NOT present** — this is the blocker.

## 2. Hardcoded or env-driven? Which var?

**Hybrid.** A hardcoded base array (localhost ×3 + `app.sorenavisa.com` + the Railway
URL) is **extended at runtime** by the **`ALLOWED_ORIGINS`** env var (comma-separated).
So production origins can be added **via env, without touching code** — the mechanism
already exists.

`ALLOWED_ORIGINS` is documented in `.env.example` and `backend/.env.example` (line 17),
but only with the dev value:

```
ALLOWED_ORIGINS="http://localhost:3000"
```

## 3. Frontend's production API base URL setting

Two separate things must both be correct for the live site to work:

**(a) The frontend ORIGIN** (the site the browser loads) — this is what CORS must
allow. You've stated it will be **`www.sorenavisa.com`**. The code currently *assumes*
`app.sorenavisa.com` (baked into the CORS list); nothing in the repo confirms `app.` is
actually used, so treat it as stale/assumed.

**(b) The frontend's API base URL** (where it *calls* the backend) — resolved in
`frontend/src/lib/api.ts` (lines 1–4):

```ts
const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';
```

It is **env-driven**, but the only documented value is the **localhost dev value**:
- `frontend/.env.example` → `NEXT_PUBLIC_API_URL=http://localhost:3001`
- `frontend/.env.local` → `NEXT_PUBLIC_API_URL=http://localhost:3001`,
  `NEXT_PUBLIC_BACKEND_URL=http://localhost:3001`

**There is no documented production API URL.** The prod frontend build must set
`NEXT_PUBLIC_BACKEND_URL` (or `NEXT_PUBLIC_API_URL`) to the real backend URL, or it will
try to call `http://localhost:3001` and fail. This is separate from CORS but required
for the live site.

## 4. Exact recommended change

**Primary fix (zero code change) — set the backend production env var.** Because the
allowlist already appends `ALLOWED_ORIGINS`, add the real origins in the Railway/host
environment for the backend:

```
ALLOWED_ORIGINS=https://www.sorenavisa.com,https://sorenavisa.com
```

- **Allow BOTH www and non-www (apex):** yes. Browsers send the *exact* origin, and
  `https://sorenavisa.com` and `https://www.sorenavisa.com` are different origins. Even
  if you redirect apex→www at the host/DNS layer, listing both is cheap insurance.
  Use **no trailing slash** and **`https`** only.
- **Keep it in the env var, not hardcoded** — this is the intended, code-free path and
  keeps domains out of source control.
- **Do NOT set `ALLOWED_ORIGINS=*` in production** — with `credentials: true`, allow-all
  would let any website make authenticated requests to the API (security risk).

**Also required for the live site (adjacent, not CORS itself):**
- Set **`NEXT_PUBLIC_BACKEND_URL`** on the frontend prod build to the real API URL
  (e.g. `https://api.sorenavisa.com` or the prod backend host).
- **Cross-site cookie check:** if the frontend (`www.sorenavisa.com`) and the API are on
  different sites/subdomains, the `sorena_session` cookie must be issued with
  `SameSite=None; Secure` (and an appropriate domain) so it is sent on
  `credentials: 'include'` requests. Verify this separately from CORS.

**Optional cleanup (code change — your call, NOT required for launch):** the hardcoded
`https://app.sorenavisa.com` in `main.ts` is baked in. If `app.` is not a real host it
is dead config. The durable improvement is to move **all** production origins out of the
array and into `ALLOWED_ORIGINS`, leaving only `localhost:*` hardcoded for dev — so
domains never drift in code. This is separate from the launch fix above.

### Recommended env values by environment

| Environment | `ALLOWED_ORIGINS` | `NEXT_PUBLIC_BACKEND_URL` (frontend) |
|---|---|---|
| Local dev | *(unset, or `http://localhost:3000`)* | `http://localhost:3001` |
| Production | `https://www.sorenavisa.com,https://sorenavisa.com` | `https://<prod-api-host>` |

## 5. Does this keep localhost working for local dev?

**Yes.** `http://localhost:3000` (and `:3001`, `:3002`) are in the **unconditional
hardcoded array** in `main.ts`, independent of `ALLOWED_ORIGINS`. Setting
`ALLOWED_ORIGINS` in production **appends** origins — it never removes localhost.
Locally you simply don't set `ALLOWED_ORIGINS` (or leave it as `http://localhost:3000`),
so local dev is unaffected. **The change touches production origins only; `localhost:3000`
stays allowed.**

---

## Summary

- **Cause:** CORS allowlist has `app.sorenavisa.com`, not the real `www.sorenavisa.com`.
- **Fix:** set backend env `ALLOWED_ORIGINS=https://www.sorenavisa.com,https://sorenavisa.com`
  (both www + apex) — **no code change**, since the allowlist already appends this var.
- **Also:** set the frontend prod `NEXT_PUBLIC_BACKEND_URL`, and verify the session
  cookie is `SameSite=None; Secure` if front-end and API are cross-site.
- **Dev safety:** `localhost:3000` is hardcoded and always allowed; the fix is
  production-only.
- **Do not** use `ALLOWED_ORIGINS=*` in production (credentialed allow-all is unsafe).
