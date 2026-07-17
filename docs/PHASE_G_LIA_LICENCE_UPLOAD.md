# PHASE-G — LIA licence upload, surfaced in the staff portal

Launch-blocking fix: LIA sessions were unbookable because no LIA adviser could
get **verified**, and an LIA (Sheila) had no way to reach the licence-upload
screen. The upload UI already existed and worked — it was just **orphaned**:
LIA advisers land on `/staff` post-login, but the licence page lived in the
legacy `/lia` portal, reachable only by typing the URL. This PR surfaces the
existing, proven screen inside `/staff` with an LIA-only sidebar entry.

## 1. What this PR does

- Adds a **"My Licence"** sidebar entry in the staff portal, visible to the
  **LIA role only**, linking to a new `/staff/lia-profile` route.
- That route re-hosts the **existing** `LicencePageClient` (the `/lia/licence`
  screen) inside the `/staff` shell — no rebuild, no second implementation.
- Makes the client component's back-link **prop-driven** so it reads correctly
  in both shells (default preserves the original `/lia` behaviour).
- Hardens the two LIA credential **write** endpoints with a tighter per-IP
  `@Throttle` (20/min) on top of the global 60/min baseline.

Once an LIA saves their IAA number **and** uploads a licence file, they appear
in the OWNER's `/staff/lia-verification` queue → an OWNER verifies → the LIA
becomes eligible → LIA sessions become bookable.

## 2. Files changed

**Frontend**
- `app/staff/lia-profile/page.tsx` — **new**. Server-gated to LIA; renders
  `<LicencePageClient backHref="/staff" .../>`.
- `app/lia/licence/LicencePageClient.tsx` — back-link made prop-driven
  (`backHref`/`backLabel`, defaults `/lia` + "Back to dashboard"). No behaviour
  change to the existing `/lia/licence` page.
- `components/staff/shell/StaffSidebar.tsx` — `Award` icon import,
  `LIA_SELF_ROLES = ['LIA']`, and the "My Licence" NAV entry.

**Backend**
- `staff/lia-profiles/lia-profiles.controller.ts` — `@Throttle` on
  `PUT licence-number` and `POST licence-file`.

**Test (local-only, gitignored):** `backend/scripts/test-lia-licence-nav.ts`.

**Nothing was rebuilt** — the form, upload, state banners, validation, and
microcopy are the existing `LicencePageClient` (PR-DOCUSIGN-1 step 3, Screen A).

## 3. Why reuse, not rebuild

A complete licence screen already existed at `/lia/licence`: licence-number
form (zod `/^[0-9]{6,12}$/`), multipart file upload (PDF/PNG/JPG, 10 MB), the
four verification states (Verified / Rejected / Awaiting review / Incomplete),
"what happens next" microcopy, navy/gold styling, 48px buttons, and it never
sends a userId. Rebuilding it under `/staff` would have duplicated ~450 lines
of tested code and invited drift. The gap was **discoverability**, so the fix
is a route + a nav entry that reuse the same component.

## 4. Endpoint contract (unchanged — pre-existing, now reachable)

| Endpoint | Guard / throttle | Shape |
|---|---|---|
| `GET /staff/lia-profile/me` | `@Roles('LIA')`, 60/min | → full profile + `verificationState` |
| `PUT /staff/lia-profile/me/licence-number` | `@Roles('LIA')`, **20/min** | `{ iaaLicenceNumber }` → `{ ok, changed, resetsVerification }` |
| `POST /staff/lia-profile/me/licence-file` | `@Roles('LIA')`, **20/min** | multipart, field `file` → `{ ok, fileName, sizeBytes, mime, replacedPrior, resetsVerification }` |
| `GET /staff/lia-profile/me/licence-file/download-url` | `@Roles('LIA')`, 60/min | → `{ url: '/files/signed/:token', expiresInSeconds: 300 }` |

`userId` always comes from the JWT (`req.user.userId`) — no userId in
path/query/body on any route. Files land in `./uploads/pending/` (multer) then
the service renames to `./uploads/lia-licences/<userId>/`; downloads only via a
5-minute JWT-signed `/files/signed/:token`. Changing the number **or** the file
clears any prior verification in the same transaction.

## 5. Configuration

None new. Upload dir is `UPLOAD_DIR` (default `./uploads`). Strength/format
rules unchanged: IAA number 6–12 digits; file PDF/PNG/JPG ≤ 10 MB.

## 6. How to test

- **Structural** (`scripts/test-lia-licence-nav.ts`, **17/17**): "My Licence"
  entry exists, gated `LIA_SELF_ROLES`; the role-filter shows it to LIA and **no
  other role** (FINANCE takes a separate nav with no licence entry); the route
  redirects non-LIA server-side and reuses `LicencePageClient` with the `/staff`
  back-link; the client hits only `/me` endpoints and never sends a userId;
  upload is multipart `file`; controller is `@Roles('LIA')` with `@Throttle` on
  both writes.
- **Runtime backend** (`lia-profiles.service.spec.ts`, **10/10**): upload
  persists + creates the `liaProfile` row; the profile appears in
  `listPendingVerification` only when **both** number and file are present;
  wrong-type / oversized files rejected; verification cleared on change.
- `tsc` clean (frontend 0 errors); `nest build` clean; `next build` clean.

## 7. Known limitations

- **The `/lia/licence` route still exists** and is unchanged. LIA advisers now
  reach the screen via `/staff/lia-profile`; the legacy URL remains reachable
  and renders in the `/lia` shell. Deliberately not removed here — deleting the
  legacy portal is out of scope and would widen the blast radius.
- **Local-disk storage.** Files live on the container's disk
  (`./uploads/lia-licences/`), not object storage — a Railway redeploy on
  ephemeral disk can lose uploaded files. Pre-existing (PR-DOCUSIGN-1); flagged,
  not fixed here.
- **No verification-reminder nudge.** An LIA who uploads but is never verified
  sees "Awaiting review" indefinitely; there is no prompt to the OWNER beyond
  the queue. Follow-up if it becomes an issue.

## 8. How to extend

- To retire the legacy `/lia/licence`: point it at a redirect to
  `/staff/lia-profile` (both gate LIA), then delete the `/lia/licence` folder.
- To move storage off local disk: swap the service's `fs.rename` for the S3
  client already used elsewhere (`@aws-sdk/client-s3`) and store the object key
  in `iaaLicenceFileUrl`; the signed-download util already abstracts retrieval.
- To surface verification status elsewhere (e.g. the LIA dashboard), read
  `GET /staff/lia-profile/me` → `verificationState`.

## 9. Security layers applied

- **Own profile only** — every route is `@Roles('LIA')` + `RolesGuard`, and
  `userId` is taken from the JWT; the DTOs/paths carry no userId. An LIA cannot
  read or write another LIA's profile — there is no parameter to attack.
- **Route gating, defence in depth** — `/staff/lia-profile` redirects non-LIA
  server-side (clean UX); the backend would 403 them anyway on the first call.
- **File upload hardening** — 10 MB cap (client + multer + service re-check);
  MIME whitelist PDF/PNG/JPG (client `accept`, multer `fileFilter`, service
  re-validate); uploads quarantined in `pending/` then renamed; downloads only
  via 5-minute signed tokens.
- **Rate-limited** — global 60/min/IP, tightened to **20/min/IP** on the two
  write endpoints (licence-number, licence-file).
- **Audited** — `LIA_LICENCE_NUMBER_SET` / `LIA_LICENCE_UPLOADED` rows written
  in the same transaction as the mutation, with actor name/role snapshot.

## 10. Rollback procedure

- **Code:** revert the commit. The sidebar entry and `/staff/lia-profile` route
  disappear together; `LicencePageClient` falls back to its `/lia` default
  back-link; the `@Throttle` reverts to the global 60/min. The existing
  `/lia/licence` screen and all backend behaviour are untouched.
- **No schema / data change** — this PR adds no migration and writes no data;
  nothing to roll back on the database side.
- **Order:** deploy backend and frontend together (frontend links to endpoints
  that already exist and are unchanged); either can ship first safely.
