# PR-OPS-COMPLIANCE — OPS Compliance page (contract exceptions)

A read-only OPS surface that answers one question: **which ACTIVE cases are
missing a signed engagement contract they shouldn't be missing?** It mirrors
`/ops/handoffs` structurally — derived from existing rows, no writes, no new
tables, no migration. The OPS lettered sibling of PHASE_A_OPS_DOCUMENTS.

## 1. What this PR does

- Adds a new OPS route `/ops/compliance` (page + nav entry), gated exactly like
  the rest of the OPS portal.
- Adds a backend controller + service under `ops/compliance` that returns the
  list of ACTIVE cases whose **contract** is a compliance exception.
- **One check only — the contract.** Consent and document checks from the scan
  were dropped on purpose:
  - *Consent* — not honestly buildable per-case (no per-case required-consent
    signal exists; `ConsentRecord` attaches to the legacy `LeadCapture` funnel,
    reachable only via a fragile multi-hop path many cases don't have).
  - *Documents* — duplicates the existing `/ops/documents` unreviewed queue.
- **Unchanged on purpose:** the `/ops` layout gate, every other OPS surface, and
  all case/contract write paths. This surface reads and links out only.

## 2. Files changed

**Backend** (new module `backend/src/ops-compliance/`)
- `ops-compliance.service.ts` — **new** `OpsComplianceService.listNonCompliant()`.
- `ops-compliance.controller.ts` — **new** `@Controller('ops/compliance')`,
  `GET /ops/compliance/non-compliant`.
- `ops-compliance.module.ts` — **new** module (imports `PrismaModule`).
- `src/app.module.ts` — import + register `OpsComplianceModule`.

**Frontend**
- `src/app/ops/compliance/page.tsx` — **new** client page (mirrors
  `ops/handoffs/page.tsx`).
- `src/components/portal/PortalLayout.tsx` — add `ShieldCheck` import + a
  `Compliance` nav item to the `ops` array (after `Handoffs`).

**Test (local-only, gitignored)**
- `backend/scripts/test-ops-compliance.ts` — runtime proof (see §6).

No schema file touched. **No migration.**

## 3. Schema added

**None.** The feature is 100% derived from existing models:
- `Case` — `stage` (active = `stage NOT IN ('COMPLETED','WITHDRAWN')`),
  `createdAt`, `lead → contact.fullName` for display.
- `Contract` — 1:1 with `Case` via `Contract.caseId @unique`; fields read:
  `status`, `signedAt`, `createdAt`, `declinedAt`.

## 4. Endpoint contract

### Route
`GET /api/ops/compliance/non-compliant` — **OPERATIONS + admin tier only.**

### Guards
`JwtAuthGuard` → `RolesGuard` + `@Roles('OPERATIONS','ADMIN','SUPER_ADMIN','OWNER')`,
plus `@Throttle({ default: { ttl: 60000, limit: 30 } })` (tighter than the global
60/min/IP baseline).

### Response
```jsonc
{
  "rows": [
    { "caseId": "…", "clientName": "Jane Doe", "stage": "VISA",
      "reason": "contract_missing", "since": "2026-05-01T12:00:00.000Z" }
  ]
}
```
`reason ∈ { contract_missing, contract_unsigned, contract_stalled, contract_declined }`.
`since` is ISO-8601 or `null`. Rows are **failing cases only, oldest-first**.

### The check (definition)
A case is ACTIVE (`stage NOT IN ('COMPLETED','WITHDRAWN')`) **and** either:
- **(a)** `stage IN ('VISA','INZ_SUBMITTED')` **and** the contract is null
  (`contract_missing`) or present-but-unsigned (`contract_unsigned`); **or**
- **(b)** a `Contract` exists with `status IN ('SENT','VIEWED','DECLINED','EXPIRED')`
  and `signedAt IS NULL` — `contract_declined` for `DECLINED`, else
  `contract_stalled`.

A fresh **ADMISSION**-stage case with no contract (or an unsent `DRAFT`) is
**not** flagged — that's the normal pre-contract window. One most-specific reason
per case (precedence: declined > stalled > unsigned > missing).

## 5. Configuration

None. No new env vars, no feature flag. Uses the app-wide `ThrottlerModule`
already registered in `app.module.ts`.

## 6. How to test (manual + automated)

**Automated:** `backend/scripts/test-ops-compliance.ts` (local-only, gitignored) —
13/13 checks, seeds → asserts → cleans up. Run:
```
cd backend && npx ts-node scripts/test-ops-compliance.ts
```
Covers: VISA-stage unsigned **appears** (`contract_missing`); ADMISSION-stage
with no contract does **not** appear; signed-contract case does **not** appear;
ADMISSION-stage stalled envelope **appears** (`contract_stalled`); VISA-stage
declined **appears** (`contract_declined`); COMPLETED case excluded; reason codes
correct; oldest-first ordering; `RolesGuard` → **403** for a non-OPS role,
allowed for OPERATIONS.

**Manual:** sign in as OPERATIONS, open `/ops/compliance`. Cases with an unsigned
contract at visa stage (or a stalled/declined envelope) show with human microcopy
and a **Open case** deep-link. Sign in as a non-OPS role → the `/ops` layout
redirects; hitting the API directly → **403**.

## 7. Known limitations

- **Contract only.** Consent and document compliance are intentionally out of
  scope (see §1). Extending to consent requires a real per-case, required-vs-
  optional consent model that does not exist today — do **not** infer one.
- `since` for `contract_missing` uses the **case** `createdAt` (no contract
  timestamp exists) — a proxy for "how long the case has run without a contract",
  not a contract-event time.
- Cross-case by design: OPS is a SEE_ALL tier, so the list is not filtered by
  per-case assignment (matches `/ops/handoffs` and `/ops/documents`).

## 8. How to extend

- **Add another honest check** (e.g. a future required-consent rule): add a
  reason code to `ComplianceReason`, a branch to the `findMany` `where`/`OR`, a
  case in `classify()`, and a microcopy entry in `ISSUE_LABEL` on the page.
- **Make it actionable:** today each row links to the case. A "send contract"
  action would live behind the existing contract write endpoints, not here (this
  surface stays read-only).

## 9. Security layers applied

- **Server-side role enforcement** on the endpoint via `RolesGuard` +
  `@Roles('OPERATIONS','ADMIN','SUPER_ADMIN','OWNER')` — not only the `/ops`
  layout gate. `RolesGuard` throws `ForbiddenException` (403) for anyone else.
- **Entitlement match:** identical gate to the sibling OPS endpoints
  (`/ops/handoffs`, `/ops/documents`); OPS is the SEE_ALL tier, so no case is
  leaked beyond that boundary.
- **Rate-limited:** `@Throttle({ default: { ttl: 60000, limit: 30 } })` on top of
  the global 60/min/IP baseline.
- **Read-only:** no mutations, no DTO/body, `@Get` only.

## 10. Rollback procedure

- **Code:** revert the commit. The route, controller, service, and nav entry all
  disappear together; nothing else references them.
- **Schema:** none added — nothing to roll back.
- **Order:** no ordering constraint (no migration, no data change).
