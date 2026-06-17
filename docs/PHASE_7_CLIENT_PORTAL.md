# PHASE 7 — Client Portal (Self-Service for LEAD / STUDENT)

> Handover document. Written so a developer joining in 6 months can read **only this file** and understand the Client Portal feature completely.
>
> **Status:** ✅ Done and live in production.
> **Live frontend:** https://sorena-visa-platform-aawd.vercel.app
> **Final commit on `main`:** `eb16308` (STUDENT layout gate)
> **Date completed:** 2026-06-18

---

## 1. What this phase does — plain English

Phase 7 gives clients (role `LEAD` or `STUDENT`) a calm, self-service portal where they can see their own case status, the people working on it, and the documents we share with them — and nothing else. They sign in with Google, get routed to `/portal/case`, see a friendly status message ("We're preparing your application", etc.), the names of their assigned team members, their INZ reference number once one exists, and a link to their documents (upload-only — they can't delete). It's deliberately minimal: one focused page per task, navy/gold calm design, mobile-first. Strong "only their own case" enforcement at every layer: the backend query joins on `case.lead.contact.userId = <JWT subject>` so no case-id parameter even exists.

---

## 2. Files created or changed

Repo: `https://github.com/sorenastudy-stack/SorenaVisaPlatform`. Paths relative to repo root.

### Backend (NestJS — Railway)

| File | Purpose |
|------|---------|
| `backend/src/auth/contact-link.helper.ts` | **NEW.** `linkContactByEmail(prisma, email, userId)` — idempotent `updateMany` that links a Contact to a User when (a) the emails match case-insensitively AND (b) the Contact has no `userId` yet. Safe to call on every sign-in. |
| `backend/src/auth/google.strategy.ts` | **CHANGED.** `verifyGoogleProfile()` now calls `linkContactByEmail` after the existing find-or-bump logic and before returning. Five failure paths still throw `UnauthorizedException` *before* reaching the link — invite-only is preserved. |
| `backend/src/portal/portal.module.ts` | **NEW.** Wires the client-only `/portal/*` surface. Imports `PrismaModule`. |
| `backend/src/portal/portal.controller.ts` | **NEW.** `@Controller('portal') @UseGuards(JwtAuthGuard, RolesGuard) @Roles('LEAD', 'STUDENT')`. One route: `GET /portal/me/case`. Takes NO case-id param — the case is derived from the JWT subject. |
| `backend/src/portal/portal.service.ts` | **NEW.** `getMyCase(userId)` — finds the case via `prisma.case.findFirst({ where: { lead: { contact: { userId } } }, orderBy: { createdAt: 'desc' } })`, returns a whitelisted shape (see §3). Throws `NotFoundException` for no-case rather than 403 so the frontend can render a calm "no case yet" panel. |
| `backend/src/app.module.ts` | **CHANGED.** Registers `PortalModule`. |

Tests:
- `backend/src/auth/contact-link.helper.spec.ts` (5 cases — idempotency, case-insensitive match, the `userId: null` guard, no collateral writes).
- `backend/src/auth/google.strategy.spec.ts` (updated branches (b) and (e) to assert the link call happens with the verified email + resolved user id).
- `backend/src/portal/portal.service.spec.ts` (16 cases — whitelisted shape, 404 on no-case, exhaustive forbidden-field exclusion, role-gate metadata on the controller, `RolesGuard` accepts LEAD/STUDENT and rejects all 10 known non-client roles).

### Frontend (Next.js — Vercel)

| File | Purpose |
|------|---------|
| `frontend/src/app/portal/layout.tsx` | **NEW.** Server-component role gate. Not signed in → `/login?next=/portal`. Signed in but role ∉ {LEAD, STUDENT} → `/unauthorized`. Renders a minimal `<ClientPortalHeader>` + main. |
| `frontend/src/app/portal/page.tsx` | **NEW.** Redirects to `/portal/case` (the real landing). |
| `frontend/src/app/portal/case/page.tsx` | **NEW.** Server component. Fetches `/portal/me/case` via `apiServer`. Renders the navy status hero with the friendly stage message, "Your team" (only filled slots), INZ reference card (if `inzApplicationNumber` set), and a Documents CTA card. Three branches: success, calm 404 ("Your case isn't set up yet"), calm error. |
| `frontend/src/app/portal/case/documents/page.tsx` | **NEW.** Server component. Resolves the client's own caseId via `/portal/me/case`, then mounts `<CaseDocumentsPanel caseId={...} canDelete={false} />`. Reuses the existing R2 documents endpoints unchanged. |
| `frontend/src/components/portal/ClientPortalHeader.tsx` | **NEW.** `'use client'`. Navy header with the Sorena wordmark + a "Sign out" button (POSTs `/api/auth/logout` then `router.push('/login')`). |
| `frontend/src/components/cases/CaseDocumentsPanel.tsx` | **NEW (moved + refactored).** The Documents panel from Phase 5, moved out of the staff-only folder. Now takes a required `canDelete: boolean` prop instead of reading `useStaff()`. Staff side passes `true`; client side passes `false`. |
| `frontend/src/components/staff/cases/detail/CaseDocumentsPanel.tsx` | **DELETED.** Replaced by the shared version above (git tracked as a 93%-similarity rename). |
| `frontend/src/components/staff/cases/detail/CaseDetailClient.tsx` | **CHANGED.** Import path updated; passes `canDelete={true}` to the shared panel. |
| `frontend/src/lib/role-redirect.ts` | **CHANGED.** Added `LEAD: '/portal/case'`. Changed fallback for unknown role from `/student` (which 403s anyone non-STUDENT) to `/login`. |
| `frontend/src/i18n/request.ts` | **NEW.** `getRequestConfig` for `next-intl/server`. Resolves the active locale (cookie `NEXT_LOCALE` if present; defaults to `'en'` to match the client-side Zustand store's default) and loads the matching messages file. Required for any server component that calls `getTranslations()` — without it, those calls throw at request time (see §7 Gotcha). |
| `frontend/next.config.js` | **CHANGED.** Wrapped `nextConfig` with `createNextIntlPlugin()` so next-intl's runtime can find `request.ts`. |
| `frontend/src/i18n/messages/en.json` + `fa.json` | **CHANGED.** New top-level `portal.*` block with stage messages, team labels, INZ heading, document copy, and no-case / error microcopy. English + Persian both. |
| `frontend/src/app/student/layout.tsx` | **CHANGED.** Added a STUDENT-only role gate matching the `/portal/layout.tsx` pattern. Closes a pre-existing gap where any signed-in user could render the student shell. |

---

## 3. Database tables/columns added

**None.** Phase 7 added **no new tables, columns, or indexes.** The Contact↔User link from Step 1 writes to the existing `Contact.userId` column (a `String? @unique` field that has been in the schema since the original Contact model). Step 1 simply added a code path that *populates* the column at Google sign-in time — no migration involved.

---

## 4. Environment variables added

**None.** Phase 7 added no new env vars to either Railway (backend) or Vercel (frontend). It reuses what was already there: `JWT_SECRET` (frontend + backend, for cookie verification), `NEXT_PUBLIC_BACKEND_URL` (frontend, for `apiServer`/`api` to reach Railway), `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `GOOGLE_CALLBACK_URL` (backend, for the existing Google strategy).

---

## 5. Third-party services connected

**No new services.** Phase 7 uses the existing Google OAuth integration for sign-in, Vercel for frontend hosting, Railway for backend + Postgres, and Cloudflare R2 (from Phase 5) **indirectly** via the documents endpoints that the client portal's Documents page hits.

The portal's Documents page is the first client-facing surface that touches R2. The same R2 bucket and CORS policy from Phase 5 apply — no Cloudflare changes were required.

---

## 6. How to test it works (manual test)

You need a client-roled user with a linked Contact + Case to actually exercise the portal. Your OWNER account will never see it — `/portal/layout.tsx` redirects non-LEAD/STUDENT to `/unauthorized`.

### One-time setup (test client)

This is what we ran in production on 2026-06-18 against the Railway Data tab:

1. **Pick a Google account you control** that you don't mind tying to a client identity (we used `sorenacharity@gmail.com`).
2. **Seed the rows in Railway Data tab**, in order — User first, then Contact (linked to the User), then a Lead, then a Case:
   ```sql
   -- (a) User row, role LEAD, no password (Google-only).
   INSERT INTO users (id, email, name, role, "isActive", "createdAt", "updatedAt")
   VALUES ('fdf81379-e5be-4a1b-968d-1b318a3ff925',
           'sorenacharity@gmail.com', 'Test Client', 'LEAD', true, NOW(), NOW());

   -- (b) Contact row, linked to the User above.
   INSERT INTO contacts (id, "fullName", email, "userId", "preferredLanguage", "createdAt", "updatedAt")
   VALUES ('a10e18b1-1a71-449f-bc9c-8243204b28b8',
           'Test Client', 'sorenacharity@gmail.com',
           'fdf81379-e5be-4a1b-968d-1b318a3ff925', 'en', NOW(), NOW());

   -- (c) Lead pointing at that Contact.
   INSERT INTO leads (id, "contactId", "sourceChannel", "leadStatus", "createdAt", "updatedAt")
   VALUES (gen_random_uuid()::text, 'a10e18b1-1a71-449f-bc9c-8243204b28b8',
           'PUBLIC_INTAKE', 'NEW', NOW(), NOW())
   RETURNING id;
   -- ↑ note the returned lead id for the next step

   -- (d) Case linked to the Lead, optionally populating the four staff slots.
   --     Fetch staff ids first with:
   --       SELECT id, name, role FROM users
   --       WHERE role IN ('LIA','CONSULTANT','SUPPORT','FINANCE') AND "isActive" = true;
   -- Note: "ownerId" is the Admission Specialist slot — codebase legacy. The role enum is CONSULTANT; the UI label is "Admission Specialist".
   INSERT INTO cases (id, "leadId", stage, status, "liaId", "ownerId", "supportId", "financeId", "createdAt", "updatedAt")
   VALUES (gen_random_uuid()::text, '<LEAD_ID_FROM_STEP_C>',
           'ADMISSION', 'active',
           '<LIA_ID>', '<CONSULTANT_ID>', '<SUPPORT_ID>', '<FINANCE_ID>',
           NOW(), NOW());
   ```
3. **Verify the whole chain resolves** (should return 1 row, stage = `'ADMISSION'`):
   ```sql
   SELECT u.email, u.role, ca.id AS case_id, ca.stage
   FROM users u
   JOIN contacts ct ON ct."userId" = u.id
   JOIN leads l ON l."contactId" = ct.id
   JOIN cases ca ON ca."leadId" = l.id
   WHERE u.email = 'sorenacharity@gmail.com';
   ```

### Click-test

1. Sign out of any existing session. Visit the live URL and click **Continue with Google**, using the test account from step 2 above.
2. After Google OAuth, you should land on `/portal/case` directly (LEAD → `/portal/case` via the updated `ROLE_REDIRECT`).
3. Expect: navy header with **Sorena · MY CASE** + **Sign out** button. Hero card shows *"We're preparing your application"* (the friendly mapping for stage `ADMISSION`). "Your team" lists the four staff names. No INZ card (the seed didn't include `inzApplicationNumber`). A navy-bordered Documents card at the bottom.
4. Click the Documents card → lands on `/portal/case/documents`. Upload a PDF/JPG/PNG under 15 MB. Expect "Uploaded ✓" then the file appears in the list. Click View → opens in a new tab. **No Remove button** on any row.
5. Click Sign out → redirects to `/login`.
6. Sanity: sign in as your OWNER → open Marcus Lee's case → Documents tab still works and the Remove button is present (staff unchanged).
7. Negative: sign in as the OWNER but try to navigate directly to `/portal/case` → should redirect to `/unauthorized` (because OWNER is not in `CLIENT_ROLES`).

✅ All seven steps were verified passing on 2026-06-18.

---

## 7. Known limitations

- **Gotcha: server-side `getTranslations()` requires the next-intl plugin + `request.ts`.** This bit us during the first LEAD sign-in: the portal's server components called `await getTranslations()` from `next-intl/server`, but next-intl had no server-side config registered (the entire codebase had only used the client-side `useTranslations` until then). The page threw a Vercel server-side digest. **Fix shipped:** `frontend/src/i18n/request.ts` + `createNextIntlPlugin()` in `next.config.js`. Any future server component that calls `getTranslations()` will now Just Work. **Don't remove the plugin** unless you've also removed every server-side `getTranslations()` call.
- **Server-side Persian doesn't work today.** `request.ts` defaults to `'en'` because the client-side locale lives in a Zustand store with no cookie/header backing — defaulting server-side to anything else would cause React hydration mismatches. A small follow-up that teaches the `LocaleProvider` toggle to write a `NEXT_LOCALE` cookie would automatically light up server-side Persian (the cookie path is already in `request.ts`).
- **One client → one case display.** `PortalService.getMyCase` returns "the most recent case" (`orderBy: createdAt desc`). If a client legitimately has multiple cases (rare, but `Case.leadId` is not unique), the portal silently shows only the newest. A future "switch case" picker would surface the others.
- **Clients can't delete documents through the portal.** By design — the `CaseDocumentsPanel` is mounted with `canDelete={false}`, and the backend `documents-access.helper.ts` denies the delete mode for LEAD/STUDENT roles too. If a client needs a document removed, staff must do it from the staff case detail page.
- **No client-side notifications.** The portal renders state at page-load time. A client who's looking at `/portal/case` while their LIA reassigns gets no live update — they have to refresh. Web sockets or polling are out of scope for Phase 7.
- **`/student/*` still exists in parallel.** STUDENT-role users continue to land on `/student/dashboard` (rich existing surface), not `/portal/case`. LEAD users (new) get the minimal portal. This split is intentional but means a STUDENT signing in won't see the new portal — they'd have to navigate to `/portal/case` directly.

---

## 8. How a future developer would extend this

- **Persist the locale toggle to a cookie:** edit `LocaleProvider` to also `document.cookie = 'NEXT_LOCALE=...; path=/'` whenever the locale changes. Server-side renders will immediately respect it — no code change needed in `request.ts` (the cookie path is already there).
- **Add a "messages" tab** for the LEAD ↔ LIA thread: a new server component at `/portal/case/messages` that hits a new client-facing `/portal/me/case-messages` endpoint (mirroring the existing PR-LIA-4 surface but role-gated to LEAD + STUDENT). The shared layout already handles auth.
- **Show the assigned staff member's photo + bio:** widen the `PortalService.getMyCase` whitelist to include `assignedLia.photoUrl` and `assignedLia.specialisation` (both already on the User model). Just don't forget to keep `id`, `email`, `role` out of the response.
- **Support multiple cases per client:** change `findFirst` → `findMany` in `PortalService.getMyCase`, add a `caseId` URL segment under `/portal/case/[caseId]`, validate that the requested case actually belongs to the caller before rendering. The WHERE-clause-is-the-gate principle still holds — just join `case.id = ? AND case.lead.contact.userId = ?` instead of relying on findFirst alone.
- **Add a "Reply to LIA" or upload-with-message:** the upload flow can already accept a `category` string (the Document model has a nullable `category` column). Surface that in `request-upload` body, and add a textarea to the upload UI.

---

## 9. Security layers applied

| Layer | Applied? | Where |
|-------|----------|-------|
| **2. Row-level / role-based access** | ✅ | Three independent layers, defence-in-depth: (a) Frontend layout gates — `/portal/layout.tsx` redirects non-LEAD/STUDENT to `/unauthorized`; `/student/layout.tsx` does the same for non-STUDENT (the security tidy at commit `eb16308`). (b) Backend route gate — `@Controller('portal') @UseGuards(JwtAuthGuard, RolesGuard) @Roles('LEAD', 'STUDENT')` on `PortalController`. (c) **The WHERE clause IS the gate** — `prisma.case.findFirst({ where: { lead: { contact: { userId } } } })` takes `userId` ONLY from the verified JWT subject; the endpoint has no case-id param, so cross-tenant access is impossible at the query layer. |
| **6. Audit log of admin actions** | ✅ | Inherited from Phase 5. Every document operation the client performs from the portal (upload confirm, download-link issue, denial-on-delete-attempt) writes a row to `audit_logs` with actor, case, and snapshots. The portal added no new audit eventTypes — it consumes the existing Phase 5 surface. |
| **7. File upload safety + signed URLs** | ✅ | Inherited from Phase 5. R2 bucket is private; uploads via presigned PUT; downloads via presigned GET; MIME whitelist + 15 MB cap enforced both client- and server-side. |
| **3. Secrets in env vars** | ✅ | No new secrets. The existing `JWT_SECRET` (Vercel + Railway), `GOOGLE_*` (Railway) are used unchanged. |
| **4. HTTPS only** | ✅ | Vercel + Railway + R2 defaults. |

**Whitelist-as-design.** `PortalService.getMyCase` builds the response by **explicit field picking, never spread** — `notes`, `riskLevel`, raw FK ids (`leadId`, `ownerId`, `liaId`, `supportId`, `financeId`), `inzSubmissionNotes`, `inzReceiptFileUrl`, and `liaAssignedAt` are deliberately omitted. A future schema column addition cannot leak into the client response because the picker only emits the 11 documented keys. The unit test (`portal.service.spec.ts`) builds a fixture with every forbidden field present and asserts each is **absent** from the output.

**Invite-only preserved.** Step 1's `linkContactByEmail` only runs **after** `GoogleStrategy.verifyGoogleProfile` has already verified the email, found an existing User row, and confirmed it's active and the googleId matches. The five failure paths (`!user`, `!user.isActive`, googleId mismatch, missing verified email, missing profile id) all throw before reaching the link. The link is `updateMany` with `userId: null` so it can never overwrite a Contact already linked to a different User.

---

## 10. Rollback instructions

The phase shipped as five commits, in order. Roll back in **reverse order** (newest first):

1. **`eb16308`** — STUDENT layout gate. Pure UX guard. Reverting unblocks pre-existing behaviour (any signed-in user could render the `/student/*` shell and watch `/students/me/*` 403):
   ```bash
   git revert eb16308 && git push origin main
   ```
2. **`710aa12`** — next-intl server config. **Reverting will re-break `/portal/case` and `/portal/case/documents` at request time** (`getTranslations()` will throw again). Only revert if you've also reverted `c5dfcb6` so the portal pages no longer exist:
   ```bash
   git revert 710aa12 && git push origin main
   ```
3. **`c5dfcb6`** — Step 3 (frontend). Removes the entire `/portal/*` route, the shared `CaseDocumentsPanel` move, the LEAD redirect, the locale string additions. LEAD users post-revert will hit the (now-also-removed-fallback) `/login` instead of `/portal/case` — confusing but not broken. Revert this BEFORE reverting Step 2's backend endpoint (an orphaned backend route is harmless):
   ```bash
   git revert c5dfcb6 && git push origin main
   ```
4. **`e2284b7`** — Step 2 (backend `/portal/me/case` + `PortalModule`). Backend-only. No data deletion needed; nothing writes to anything.
   ```bash
   git revert e2284b7 && git push origin main
   ```
5. **`7dcb29d`** — Step 1 (Contact↔User link at sign-in). Reverting stops the link from being created on future sign-ins but **does not undo links already made**. To also clear those:
   ```bash
   git revert 7dcb29d && git push origin main
   # Then, if you also want to clear back-fills, in Railway Data tab:
   UPDATE contacts SET "userId" = NULL
   WHERE email IN (SELECT email FROM users WHERE role IN ('LEAD','STUDENT'));
   ```
   ⚠️ The above SQL is destructive — only run if you genuinely want to disconnect every LEAD/STUDENT Contact from their User. Take a Postgres backup first (Railway → Postgres → Backups).

**Database state:** no schema changes to roll back. The `Contact.userId` column existed before Phase 7 and stays where it is.

**Cloudflare R2:** no bucket or policy changes to roll back. Documents uploaded via the portal stay valid for staff to manage.

---

## Appendix — commit history for this phase

| Commit | What it did |
|--------|-------------|
| `7dcb29d` | **Step 1** — `linkContactByEmail` helper + GoogleStrategy hook + tests. Idempotent, invite-only preserved. |
| `e2284b7` | **Step 2** — `PortalModule` + `GET /portal/me/case` (role-gated LEAD/STUDENT, whitelisted shape, no case-id param) + tests. |
| `c5dfcb6` | **Step 3** — `/portal/*` frontend (layout + case + documents pages), shared `CaseDocumentsPanel` with `canDelete` prop, LEAD redirect in `ROLE_REDIRECT`, i18n strings (en + fa). |
| `710aa12` | **Fix** — `frontend/src/i18n/request.ts` + `createNextIntlPlugin()` in `next.config.js`. Closed the runtime crash on first LEAD sign-in. |
| `eb16308` | **Security tidy** — STUDENT role gate on `/student/layout.tsx`, mirroring the portal pattern. Closes a pre-existing inconsistency. |

---

*Stack: Next.js (Vercel) + NestJS (Railway) + Railway Postgres/Prisma + Cloudflare R2 (Phase 5, used indirectly via documents endpoints). Not Supabase. Admin/OWNER: `yashoue@gmail.com`. Test client (for verifying the portal flow): `sorenacharity@gmail.com`.*
