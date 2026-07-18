# PHASE-I — Close unscoped cross-user endpoints

The placeholder scan surfaced two endpoints (`GET /leads`, `GET /commissions`)
that any authenticated user — including a self-registered `LEAD`/`STUDENT`
client — could read in full. A full sweep of all 71 controllers found the same
class of hole in **seven** controllers (reads AND writes). This PR closes them,
enforcing entitlement in the service layer for the money/funnel reads and via
`@Roles` gates on the rest.

## 1. What this PR does

- **`GET /commissions`** — role-gated to the money tier and **enforced in the
  service** (`CommissionsService.findAll`). Commissions have no per-user owner
  field, so "your own commissions" is not expressible — the correct scoping is
  a role gate. Every ledger read is **audit-logged** (money data). Sibling
  writes (`POST /commissions`, `PATCH /:id/status`) gated too.
- **`GET /leads`** — role-gated to the funnel roles and **enforced in
  `LeadsService.findAll`**; the whole `/leads` controller (create / findOne /
  updateStatus / undo / history) now carries explicit `@Roles`.
- **Five more controllers** with the same "any authenticated user" hole gated:
  `contracts`, `contacts`, `applications`, `intake`/`scoring`, `providers`.
- Rate-limited the two named reads; nothing accepts a `userId` param.

## 2. Full list of unscoped endpoints found (the sweep) + what was done

Root cause everywhere: the codebase `RolesGuard` returns **allow-all** when a
route has no `@Roles` metadata (`roles.guard.ts:16-18`), and these controllers
had either `JwtAuthGuard` only or `RolesGuard` with no `@Roles`.

| Controller | Endpoints (were ungated) | Data | Fix |
|---|---|---|---|
| **commissions** | `GET /commissions`, `POST /commissions`, `PATCH /:id/status` | commission money records | Service-layer role gate (OWNER/SUPER_ADMIN/ADMIN/OPERATIONS/FINANCE) + audit on read; writes → OWNER/SUPER_ADMIN/ADMIN/OPERATIONS |
| **leads** | `GET /leads`, `GET /:id`, `GET /:id/history`, `POST /leads`, `PATCH /:id`, `POST /:id/undo` | lead funnel + contact PII | Service-layer role gate on `findAll` + class-wide `RolesGuard` and `@Roles` on every route (OWNER/SUPER_ADMIN/ADMIN/CONSULTANT/FINANCE) |
| **contracts** | `GET /contracts/:caseId` | legal contract / DocuSign envelope | `@Roles(OWNER, SUPER_ADMIN, ADMIN, LIA)` (matches the send route) |
| **contacts** | `GET /contacts`, `GET /:id`, `POST`, `PATCH /:id`, `DELETE /:id` | CRM PII (name/email/phone) | class `RolesGuard` + `@Roles` per route: reads/writes → CRM funnel; delete → admin |
| **applications** | `GET /applications/:caseId`, `POST`, `PATCH /:id/status`, `POST /:id/documents` | admission applications + docs | class `RolesGuard` + `@Roles` (OWNER/SUPER_ADMIN/ADMIN/OPERATIONS/CONSULTANT) |
| **intake / scoring** | `POST /intake/:leadId`, `GET /scoring/:leadId`, `POST /scoring/:leadId` | lead scoring profile (readiness/financial/risk) | class `RolesGuard` + `@Roles` (funnel roles) |
| **providers** | `GET /providers` + faculties/programmes/requirements reads; `POST`/`PATCH` faculty/programme/agreement/requirement writes | provider catalog + **commercial agreement terms** | reads → admission staff; writes → admin (create/approve/reject were already ADMIN-gated) |

**Safe to gate:** every one of these had **zero frontend callers** (the UI uses
the already-gated `/staff/*` and `/ops/*` equivalents), and internal backend
code calls the services directly (bypassing controller guards), so gating the
routes breaks nothing. Fail-closed is the correct direction regardless.

## 3. Why role gate, not per-user, for commissions

`Commission` (schema) has **no** `userId`/`ownerId`/`salesRepId` — it hangs off
`application → provider → programme`, not a sales rep. So "scope to the caller's
own commissions" is impossible without a schema change. The correct scoping is a
role gate: the money-managing tier sees the ledger; everyone else is refused.
(If per-sales-rep commissions are ever needed, add an owner field to `Commission`
and scope on it — flagged in §7.)

## 4. Role sets chosen + reasoning

- **Commissions (view):** OWNER, SUPER_ADMIN, ADMIN, OPERATIONS, FINANCE — the
  commission lifecycle actors (`confirm` = OPERATIONS/SUPER_ADMIN, `reminder` =
  ADMIN/SUPER_ADMIN) plus FINANCE (money) and OWNER (sees all).
- **Leads (funnel):** OWNER, SUPER_ADMIN, ADMIN, CONSULTANT, FINANCE — **exactly**
  the set on the modern `/staff/leads` route, so the two lead surfaces agree.
  SALES is excluded there and here. Leads are a shared funnel (`Lead.ownerId` is
  a filter, not an access boundary), so no per-user scoping.
- **Contacts:** the CRM funnel set; delete is admin-only.
- **Applications:** admin tier + OPERATIONS + the CONSULTANT admission specialist.
- **Scoring/intake:** the funnel set (scoring is a funnel step).
- **Providers:** reads → admission staff; catalog/agreement writes → admin.

## 5. Configuration

None. No env, no schema change, no migration. Enforcement is guards + service
checks; the commission ledger-read audit reuses the existing `AuditLog` table
(`COMMISSIONS_LEDGER_VIEWED`).

## 6. How to test

`scripts/test-endpoint-scoping.ts` — **24/24, runtime** (constructs the real
`LeadsService`/`CommissionsService` with a mock Prisma and drives `findAll`):
- Leads: STUDENT/LEAD/SALES/no-role → **403**; a spoofed `ownerId` filter does
  **not** bypass the gate; CONSULTANT/ADMIN/OWNER → rows.
- Commissions: SALES/STUDENT/CONSULTANT/no-role → **403**; FINANCE/OWNER/ADMIN →
  rows; an entitled read writes a `COMMISSIONS_LEDGER_VIEWED` audit row; a
  **refused** read writes none.
- Scoping is driven by the JWT `actor.role`, never a client `userId` param.
- `@Roles` gate metadata asserted present on the other closed controllers
  (contacts, contracts, applications, scoring, providers) — the proven
  `RolesGuard` enforces them.

`nest build` clean. Existing module specs pass (the 4 failing `contracts.service`
tests are a **pre-existing** DB-dependent integration flake — verified identical
on baseline with my changes stashed; I only touched the contracts *controller*).

## 7. Known limitations / follow-ups (reported, not fixed)

- **`POST /payments/{subscription,consultation}/checkout`** take a body
  `leadId` under `JwtAuthGuard` only — any authenticated user can mint a checkout
  session against an arbitrary lead. This is a *write* with an ownership question
  (does this leadId belong to the caller?), not a simple role gate — fixing it
  needs lead-ownership validation and touches the live booking flow, so it's
  flagged for a focused follow-up rather than changed blind here.
- **No per-sales-rep commissions** — requires a `Commission` owner field
  (schema change) before "my commissions" can exist.
- **Provider catalog reads** are gated to staff, but providers are reference data;
  if a future client-facing surface needs to browse programmes, expose a separate
  public/STUDENT-scoped read rather than widening these.

## 8. How to extend

- Add a role to a funnel/CRM surface: edit the `FUNNEL_ROLES` / `CRM_ROLES` /
  `ADMISSION_ROLES` / `CATALOG_*` const at the top of each controller (single
  source per controller).
- Deepen enforcement: the two money/funnel reads enforce in the **service**; to
  do the same for the write routes, pass the actor into the service method and
  check there (the pattern is `LeadsService.findAll` / `CommissionsService.findAll`).

## 9. Security applied

- **Service-layer enforcement** for the two named reads — a `ForbiddenException`
  is thrown inside `findAll` before any query, so no future caller (a new route,
  an internal call) can bypass the gate.
- **Defense in depth** — controller `@Roles` + service check on the money/funnel
  reads; `@Roles` gates on all other closed routes.
- **No userId params** — access is decided by the JWT `actor.role`/`actor.id`
  only; a client cannot pass an identity to widen access (proven: a spoofed
  `ownerId` filter still 403s a non-entitled role).
- **Audit** — every commission ledger read writes an `AuditLog` row with the
  actor's name/role snapshot (money data).
- **Rate-limited** — the two named reads carry a tighter `@Throttle` (30/min/IP)
  over the global 60/min baseline.
- **Fail-closed** — gated legacy routes now refuse unknown/lesser roles rather
  than leak; safe because they had no callers.

## 10. Rollback procedure

- **Code:** revert the commit. All changes are guard decorators + two service
  role checks + one audit write; reverting restores the prior (open) behavior.
- **No schema / data change** — nothing to migrate. The `COMMISSIONS_LEDGER_VIEWED`
  audit rows are additive and harmless if left.
- **Order:** backend-only; no frontend change (the UI never called these routes).
  Deploy/rollback independently.
