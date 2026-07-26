# Phase 21 — LEAD Portal Payments & Legacy `/admin` Cleanup

End-of-phase handover for two items: (1) removing the dead legacy `/admin/*`
redirect stubs while keeping the one live admin surface, and (2) exposing the
existing client Payments view to LEAD clients in `/portal/*`. The headline finding:
**"My Case" and "Payments" were already built** under the unified client shell — the
only real gap was that Payments wasn't reachable by the LEAD role.

**Date:** 2026-07-26
**Commit (this phase):**
- `c47becb` — feat(portal): LEAD-facing Payments page + remove legacy /admin redirect stubs

---

## 1. What this phase does

### Item 1 — `/admin/*` cleanup

`/admin/*` was mostly dead weight, but not entirely. What was there:

| Route | Was | Action |
|-------|-----|--------|
| `/admin/audit` | **Live audit-log browser** (backend `@Controller('admin/audit')`), linked from Compliance ("Full audit log"), Handoffs, and the admin nav | **Kept** — not replicated anywhere else |
| `/admin/cases` | redirect → `/ops/cases` | **Deleted** |
| `/admin/settings` | redirect → `/staff/platform-settings` | **Deleted** |
| `/admin/users` | redirect → `/staff/users` | **Deleted** |
| `/admin` (hub) | link-card landing | **Deleted** |
| `/admin/layout.tsx` | gate + shell for `/admin/audit` | **Kept** (needed for the audit page) |

The dead `Dashboard → /admin` nav item was removed from `PortalLayout`. The deleted
routes now 404 cleanly; `/admin/audit` still works. The `/admin` middleware gate is
retained (it still protects `/admin/audit`).

### Item 2 — LEAD Payments page

**Prior state (discovered, not obvious):** `/portal/*` and `/student/*` are the SAME
unified client shell (`ClientShell`, nav from `getClientShellData`). **My Case**
(`/portal/case`) and **Payments** (`/student/payments`) already existed and were
already own-data-scoped. Payments was only in the **STUDENT** nav — a **LEAD** client
had no Payments link (they pay the engagement fee via the My Case pay step).

**What this phase added** — the one real gap:
- **`GET /portal/me/invoices`** — a LEAD-safe counterpart of the STUDENT-gated
  `/students/me/invoices`. Own-data-scoped (JWT `userId` → contact → invoices),
  client-safe fields only.
- **`/portal/payments`** — a LEAD-reachable Payments page rendering the shared
  `<PaymentsView>` (history via `/portal/me/payments` + outstanding invoices via
  `/portal/me/invoices`, incl. the account-opening fee, statuses, and pending
  bank-transfer state), inside the client shell.
- **Shared `<PaymentsView>`** extracted from the old `/student/payments` inline
  markup, now used by BOTH pages (one UI, one invoice source). `/student/payments`
  was refactored to use it + the same portal endpoints.
- **"Payments" nav item** added to the LEAD nav in `getClientShellData`.

**My Case was left as-is** — it already shows stage/status, assigned specialists,
documents needed/received, and key dates. Nothing to build.

## 2. Files created or changed

Pulled from `git show --stat c47becb`.

*Created*
- `backend/src/portal/portal-invoices.spec.ts` — own-data isolation spec.
- `frontend/src/app/portal/payments/page.tsx` — the LEAD Payments page.
- `frontend/src/components/portal/PaymentsView.tsx` — shared read-only payments UI.

*Changed*
- `backend/src/portal/portal.service.ts` — `getMyInvoices(userId)` (own-data scoped).
- `backend/src/portal/portal.controller.ts` — `GET me/invoices` (LEAD/STUDENT).
- `frontend/src/app/student/payments/page.tsx` — refactored to use `<PaymentsView>`
  + `/portal/me/invoices`.
- `frontend/src/lib/clientShellData.ts` — LEAD nav gains "Payments".
- `frontend/src/components/portal/PortalLayout.tsx` — removed dead `Dashboard → /admin`.

*Deleted*
- `frontend/src/app/admin/page.tsx`, `admin/cases/page.tsx`, `admin/settings/page.tsx`,
  `admin/users/page.tsx` (hub + redirect stubs).

## 3. Database tables / columns added

**None.** `getMyInvoices` is a read over the existing `Invoice` table.

## 4. Environment variables added (names only)

**None.**

## 5. Third-party services connected

**None new.** The Pay-now button reuses the existing Stripe pay-link flow
(`POST /portal/me/invoices/:id/pay-link`).

## 6. How to test it works

**Automated** — `portal-invoices.spec.ts` (DB-backed, 2/2 green): `getMyInvoices`
returns only the caller's own invoices (client A never sees client B's, and vice
versa); an unknown userId returns `[]` (no leak, no throw); the returned shape is
client-safe (amount as string, no receipt/finance internals). Backend `tsc` + `next
build` clean; the route table confirms `/portal/payments` builds, `/admin/audit`
remains, and the deleted `/admin` routes are gone.

**Manual:**
1. Sign in as a **LEAD** client with an outstanding engagement invoice → the portal
   sidebar shows **Payments** → `/portal/payments` shows the outstanding fee (Pay-now)
   + any payment history. Confirm it matches what the **STUDENT** Payments page shows
   for that same client (same `<PaymentsView>` + same endpoints).
2. **Isolation:** as a second client, hit `/portal/payments` (and
   `GET /portal/me/invoices` directly) → you only see your own records; you cannot see
   the first client's invoices/payments via any URL.
3. **Admin:** as OWNER/SUPER_ADMIN, `/admin/audit` still loads. Visit `/admin`,
   `/admin/cases`, `/admin/settings`, `/admin/users` → each 404s cleanly.

## 7. Known limitations

- **My Case + Payments already existed** — this phase only exposed Payments to LEADs
  and cleaned up `/admin`. A future dev should not "add My Case/Payments" thinking
  they're missing; they live under the unified `ClientShell` (`/portal/*` +
  `/student/*` share it).
- **Two Payments routes exist** (`/portal/payments`, `/student/payments`) sharing one
  `<PaymentsView>` + one invoice endpoint. They differ only by header/shell; kept
  separate because `/student/*` is STUDENT-gated with its own `StudentHeader`.
- **`getMyInvoices` returns all of a client's invoices** (no pagination). Fine at
  per-client volume.
- **Pending bank-transfer status is surfaced, not managed.** The page shows an invoice
  as still "Outstanding" until Finance confirms the receipt; the Finance verification
  flow is untouched (not duplicated) — the diary/portal only reflects status.
- **`/admin/audit` stays under `/admin`.** It wasn't relocated to `/staff/audit` for
  naming consistency (would require moving the backend route + updating the Compliance/
  Handoffs links). Optional future tidy-up.

## 8. How a future developer would extend this

- **Add a payments column/section:** edit `getMyInvoices` (backend) for new fields and
  `<PaymentsView>` (frontend) for rendering — both pages update at once.
- **Relocate the audit browser** to `/staff/audit` (if desired): move
  `admin/audit/page.tsx`, repoint the backend `@Controller('admin/audit')`, and update
  the links in `ComplianceClient`, the Handoffs page, and `PortalLayout`.
- **Client's own data is always resolved from the JWT** (`userId → contact`) — never a
  client-supplied id. Any new portal read must follow that pattern (see
  `getMyInvoices` / `getMyPayments`).

## 9. Security layers applied

- **Own-data-only, server-enforced.** `getMyInvoices` resolves the caller's contact
  from their JWT `userId` and filters invoices by `contactId` — a client cannot pass an
  id to read another's invoices. Same posture as `getMyPayments` / `getMyCase`. The
  isolation spec proves A can't see B and vice versa.
- **Role-gated.** `GET /portal/me/invoices` inherits the `PortalController` gate
  (`@Roles('LEAD','STUDENT')` behind JWT + RolesGuard); the page is under the
  `/portal` layout's LEAD/STUDENT gate.
- **Client-safe projection.** The endpoint selects only display fields (id, number,
  description, amount, currency, status, dueDate) — no receipt file paths or finance
  internals.
- **Admin surface reduced.** Deleting the stubs shrinks the authenticated surface to
  the one real admin page (`/admin/audit`, OWNER/SUPER_ADMIN), which the backend gates
  independently.

## 10. Rollback instructions

No migration — a straight git revert.

1. **Full revert:** `git revert c47becb`. Restores the `/admin` hub + redirect stubs
   and the `Dashboard → /admin` nav item, removes `/portal/payments` + the LEAD nav
   item + `GET /portal/me/invoices`, and reverts `/student/payments` to its inline
   markup. No data impact.
2. **Partial (keep Payments, restore admin stubs):** `git checkout c47becb~1 --
   frontend/src/app/admin frontend/src/components/portal/PortalLayout.tsx` then
   re-commit.
3. **Partial (keep admin cleanup, drop LEAD Payments):** remove the LEAD "Payments"
   nav line in `clientShellData.ts` + delete `app/portal/payments/` — the endpoint can
   stay (harmless) or be removed from the controller.
4. **No data / env / service cleanup** — there is none.
