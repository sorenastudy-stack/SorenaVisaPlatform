# Phase 16 — Owner-Dashboard Ops Sections (Documents, Compliance, Handoffs)

End-of-phase handover for three closely-related oversight sections built into the
**Owner's own `/staff` dashboard** in one session: a cross-case **Documents** view,
a **Compliance** section, and a **Handoffs** section. All three share one deliberate
architectural decision — *we did not build a separate OPS portal* (see §1) — and all
three are read-only oversight surfaces that reuse existing backend logic wherever it
already existed, adding only the genuinely-new cross-case piece each needed.

**Date:** 2026-07-25
**Commits (this phase):**
- `dbe4b3a` — feat(owner-docs): cross-case Documents view in the Owner dashboard with role-based access
- `a6899c9` — feat(compliance): Owner-dashboard Compliance section (flagged cases + LIA-routing check + reused surfaces)
- `9a865a3` — feat(handoffs): Owner-dashboard Handoffs section (staffing exceptions reused + state-derived stuck-case rules)

---

## 1. What this phase does

### The overarching architectural decision — NO separate OPS portal (read this first)

There is a legacy **OPS portal** (`/ops/*`) with its own Documents, Compliance, and
Handoffs pages (`frontend/src/app/ops/...`), gated to a separate `OPERATIONS`
reviewer role. Earlier phases (`PHASE_A_OPS_DOCUMENTS`, `PHASE_B_OPS_COMPLIANCE`)
started down that path. **We deliberately stopped extending it and instead built
these three sections inside the Owner's own `/staff` dashboard.**

**Why — and why a future developer must NOT "helpfully" resurrect the OPS portal:**

- **The team is currently just the Owner.** There is one person doing operational
  oversight today. A separate portal for a separate `OPERATIONS` role is
  infrastructure for staff who **do not exist yet**. Building it now would be
  maintaining two parallel surfaces (auth, nav, layout, deployment) for an audience
  of zero.
- **Every real role already gets its own scoped portal when it's hired.** The
  pattern in this codebase is role-scoped dashboards (Finance portal, LIA portal,
  Support portal, Client Officer slot, etc.), each surfaced through `StaffSidebar`
  role gates. When Sorena actually hires an operations person, they get a
  *scoped* view through the same mechanism — not a bolted-on `/ops` twin.
- **The `/ops/*` pages and their backends still exist and still work** — we did not
  delete them. We **reused their backend services** (`OpsHandoffsService`,
  `ops-compliance`, the OPS documents queue) from the new Owner-dashboard sections
  so there is a single source of truth, not a fork. The OPS *frontend* pages are
  effectively dormant; the OPS *backend* logic is live and shared.

**So: if you're reading this because you were about to "finish the OPS portal" —
don't.** The Owner dashboard *is* the ops surface for now. Add a role-scoped view
when the role is actually staffed. These three sections are the template for how.

### The three sections

**Documents (`dbe4b3a`).** A cross-case Documents view at `/staff/documents` that
lists documents across *all* cases the viewer is entitled to, with strict
role-based visibility enforced by a single SSOT function `canRoleViewDocument`.
The role matrix: Client uploads their own; **Admission Officer (`CONSULTANT`)** sees
P1-typed documents only and **never** anything from the `VISA_SUPPORTING` source;
**Client Officer (`CLIENT_CONSULTANT`)** sees P1 + P2 on assigned cases; **LIA** sees
everything including visa-supporting; **Owner/admin tier** sees everything plus a
System-A "Other" bucket. Same list + download rules, unified so they can't diverge.

**Compliance (`a6899c9`).** A single `/staff/compliance` page (OWNER/SUPER_ADMIN)
composing one **new** surface — a cross-case **Flagged-cases list** (leads with
`hardStopFlag` OR `liaEscalationRequired`) with a per-case **LIA-routing-compliance
pass/fail check** — plus **reused** surfaces: contract exceptions (from
`ops-compliance`), a pre-filtered override/audit slice (linking to `/admin/audit`),
and a link to the owner-approval queue (`/staff/approvals`). The LIA-routing check:
a red-flagged lead is compliant only if, for any contract sent on its case, an
APPROVED LIA decision was recorded **before** the contract was sent.

**Handoffs (`9a865a3`).** A `/staff/handoffs` page (OWNER/SUPER_ADMIN) built on
**Definition A — "staffing handoff"** (the moment responsibility should pass to a
role and that role's slot fills). Two read-only surfaces:
- **Unstaffed roles** — reuses `OpsHandoffsService.listPendingHandoffs()` verbatim:
  a specialist slot is empty *and* the case is already past the point auto-assignment
  should have filled it (LIA/Admission/Finance after contract sign; Pastoral after
  visa approval; Client Officer via pool-empty banner + no-candidates audit; plus
  wrong-role-owner detection).
- **Stuck cases** — three progression stalls derived from *existing* state (no schema
  change): contract signed + engagement invoice PAID but still in ADMISSION; visa
  APPROVED but no pastoral assigned; INZ_SUBMITTED aged past a 21-day display
  heuristic (via the existing `inzSubmittedAt`).

## 2. Files created or changed

Pulled from `git show --stat` for each commit.

**Documents — `dbe4b3a` (10 files)**

*Created*
- `backend/src/case-documents/staff-case-documents.controller.ts` — `GET
  /api/staff/case-documents` (listAll), `@Roles` OWNER/SUPER_ADMIN/ADMIN/LIA/
  CONSULTANT/CLIENT_CONSULTANT.
- `backend/src/case-documents/case-documents.cross-case.spec.ts` — 5-role matrix +
  scoping tests (DB-backed).
- `backend/src/case-documents/document-priority.spec.ts` — `canRoleViewDocument`
  unit matrix.

*Changed*
- `backend/src/case-documents/document-priority.ts` — added the SSOT
  `canRoleViewDocument(role, source, docType)` (visa-source exclusion for the barred
  roles; CONSULTANT → P1-only).
- `backend/src/case-documents/case-documents.service.ts` — list/download now filter
  through `canRoleViewDocument`; added `listAllDocumentsAcrossCases`,
  `resolveScopedCaseIds`, and the System-A "Other" admin bucket.
- `backend/src/case-documents/case-documents.controller.ts` — CLIENT_CONSULTANT added
  to the download-url route roles.
- `backend/src/case-documents/case-documents.module.ts` — register the new controller.
- `frontend/src/app/staff/documents/page.tsx` — points at the cross-case client.
- `frontend/src/components/staff/documents/MyDocumentsClient.tsx` — repurposed to
  `/api/staff/case-documents` with source + P1/P2 badges + bucket-aware download.
- `frontend/src/components/staff/shell/StaffSidebar.tsx` — Documents nav item.

**Compliance — `a6899c9` (8 files)**

*Created*
- `backend/src/compliance/compliance.service.ts` — `listFlaggedCases()` (status +
  `routingCompliance`) and `listOverrideAuditLog()`.
- `backend/src/compliance/compliance.controller.ts` — `@Controller('api/staff/compliance')`,
  OWNER/SUPER_ADMIN, `GET flagged-cases` + `GET override-log`.
- `backend/src/compliance/compliance.module.ts`.
- `backend/src/compliance/compliance.spec.ts` — LIA-routing matrix + override-log filter (DB-backed).
- `frontend/src/app/staff/compliance/page.tsx` — server-gated page.
- `frontend/src/components/staff/compliance/ComplianceClient.tsx` — the composed page.

*Changed*
- `backend/src/app.module.ts` — register `ComplianceModule`.
- `frontend/src/components/staff/shell/StaffSidebar.tsx` — Compliance nav item.

**Handoffs — `9a865a3` (9 files)**

*Created*
- `backend/src/handoffs/handoffs.service.ts` — reuses `OpsHandoffsService` for staffing
  exceptions; adds the three stuck-case rules (reusing `getEngagementGateState` for the
  paid check).
- `backend/src/handoffs/handoffs.controller.ts` — `@Controller('api/staff/handoffs')`,
  OWNER/SUPER_ADMIN, `GET /`.
- `backend/src/handoffs/handoffs.module.ts` — imports `OpsHandoffsModule`.
- `backend/src/handoffs/handoffs.spec.ts` — staffing + stuck rules (DB-backed, 5 tests).
- `frontend/src/app/staff/handoffs/page.tsx` — server-gated page.
- `frontend/src/components/staff/handoffs/HandoffsClient.tsx` — the composed page.

*Changed*
- `backend/src/ops-handoffs/ops-handoffs.module.ts` — **exports** `OpsHandoffsService`
  so the new module can inject it.
- `backend/src/app.module.ts` — register `HandoffsModule`.
- `frontend/src/components/staff/shell/StaffSidebar.tsx` — Handoffs nav item.

The reuse-over-copy pattern (Handoffs injecting the OPS service rather than forking it):

```ts
// handoffs.service.ts
constructor(
  private readonly prisma: PrismaService,
  private readonly opsHandoffs: OpsHandoffsService, // ← same rules as /ops/handoffs
) {}

async getHandoffs() {
  const [staffing, stuck] = await Promise.all([
    this.opsHandoffs.listPendingHandoffs(), // reused verbatim
    this.listStuckCases(),                  // the only new logic
  ]);
  return { staffing, stuck, inzAgeThresholdDays: INZ_AGE_THRESHOLD_DAYS };
}
```

## 3. Database tables / columns added

**None — no schema migration in any of the three commits.** Every section is a
read-only projection over existing tables (`Case`, `Contract`, `Invoice`, `Visa`,
`Lead`, `AuditLog`, the three `*_documents` source tables). This was a hard
constraint: the deferred pieces in §7 are precisely the ones that *would* have needed
new tables, and we chose not to add them speculatively.

## 4. Environment variables added (names only)

**None.**

## 5. Third-party services connected

**None new.** All three sections read from the existing Postgres database via Prisma.
Document downloads reuse the existing R2-backed signed-URL path; no new buckets or
providers.

## 6. How to test it works

**Access gate (all three).** Sign in as OWNER (or SUPER_ADMIN) → **Documents**,
**Compliance**, and **Handoffs** appear in the `/staff` sidebar. Sign in as any other
role → Compliance and Handoffs are absent and their routes redirect to `/staff`;
their APIs (`/api/staff/compliance/*`, `/api/staff/handoffs`) return 403. Documents is
visible to the wider slot-holding set but each role sees only what
`canRoleViewDocument` permits.

**Documents (`/staff/documents`).**
1. As OWNER — see documents across all cases, including the System-A "Other" bucket,
   with source + P1/P2 badges; every download works.
2. As an **Admission Officer** (`CONSULTANT`) — see only **P1**-typed documents on
   assigned cases, and **zero** `VISA_SUPPORTING` documents (they don't appear in the
   list *and* the download-url endpoint refuses them).
3. As a **Client Officer** (`CLIENT_CONSULTANT`) — see P1 **and** P2 on assigned cases.
4. As **LIA** — see everything including visa-supporting.
5. Automated: `case-documents.cross-case.spec` (5-role matrix + scoping) +
   `document-priority.spec` — green.

**Compliance (`/staff/compliance`).**
1. Red-flag a lead (`liaEscalationRequired`) and send a contract on its case with **no**
   prior APPROVED LIA decision → the flagged-cases row shows routing = **Breach**.
2. Record an APPROVED LIA decision *before* the contract → routing = **Compliant**.
3. A hard-stop-only lead → status HARD_STOP, routing **—** (N/A). A cleared/approved
   lead drops off the list automatically.
4. Contract exceptions, override log (→ `/admin/audit`), and the approvals-queue link
   all render. Automated: `compliance.spec` — green.

**Handoffs (`/staff/handoffs`).**
1. **Unstaffed roles:** a case with a signed contract but no LIA/Admission/Finance
   assigned → appears with red role chips, oldest-first; assigning the slots clears it.
2. **Stuck — signed+paid in Admission:** a case that's contract-signed with its
   `ENG-<caseId>` invoice PAID but still in ADMISSION → appears as "Signed + paid,
   still in Admission"; advancing the stage clears it. A signed-but-**unpaid** case
   does **not** appear.
3. **Stuck — visa approved, no pastoral:** an APPROVED-visa case with no support
   officer → appears; assigning Pastoral Care clears it.
4. Automated: `handoffs.spec` (5 tests — staffing LIA/Admission/Finance, staffing
   Pastoral, paid-stuck vs unpaid, visa-no-pastoral, INZ aged vs recent) — green.

## 7. Known limitations

**Documents — per-case-loop query performance (deferred, fine at current volume).**
`listAllDocumentsAcrossCases` builds each case's document list by calling the existing
per-case builder in a loop, once per scoped case. At the current case count this is
perfectly fine and keeps the code a straight reuse of the audited per-case path. If
the case volume grows large, convert it to **batch queries** (fetch all rows across the
scoped case-id set in one query per source table, then group in memory) rather than N
per-case round-trips. This is a performance optimisation only — the access semantics
are already centralised in `canRoleViewDocument` and won't change.

**Compliance — no SLA/deadline system exists at all (deferred concepts).** Two
compliance concepts from the Operations Manual were **explicitly deferred, not
stubbed**:
- **Case routing override** — a formal, approval-gated override of an
  auto-assignment. Today, routing changes happen via ad-hoc manual reassignment
  (which *is* logged in the override/audit slice); there is no approval-gated
  "override" workflow.
- **Deadline extension approval** — approving an extension to a case deadline. This
  requires a **deadline/SLA system that does not exist anywhere in the platform**.
  There are no per-stage deadlines, no SLA timers, no due-dates on cases. Building
  "deadline extension approval" first requires building the deadline system itself.

Both are in the same "needs new infrastructure we chose not to speculatively build"
category, and are noted in the Compliance page's dashed backlog panel.

**Handoffs — only detects "slot empty," not "how long stuck in a stage" (deferred
stage-transition history).** Handoffs answers *"which role should have picked this up
but hasn't"* (empty slot) and a few *"cleared a gate but didn't move on"* stalls. It
**cannot** answer *"how long has this case been sitting in its current stage"* for any
transition other than INZ (the one stage that happens to stamp `inzSubmittedAt`),
because **there is no stage-transition history**:
- No stage-history table and no per-transition timestamp (`Case` has only
  `liaAssignedAt` and `inzSubmittedAt` as point stamps).
- CRM `Case` stage changes emit **no** `STATUS_CHANGED` audit event (the only
  `STATUS_CHANGED` emitter is the student-portal `VisaCase`, a different model).

Building the full "time-in-stage / pipeline timeline" view (Option 2) requires new
infrastructure — a `CaseStageTransition` table, **or** emitting a `STATUS_CHANGED`
audit row on every CRM stage write — plus a backfill for existing cases. This was
deferred alongside the SLA/deadline system and is noted in the Handoffs page's dashed
backlog panel. Until then, the waiting-time columns are measured from each rule's one
available timestamp (contract signed, visa issued, INZ submitted), **not** from stage
entry — and the 21-day INZ threshold is a **display heuristic, not an enforced SLA**.

**Handoffs — gate is OWNER/SUPER_ADMIN, narrower than legacy `/ops/handoffs`.** The
legacy OPS page also allowed `ADMIN` (who actually staff cases via the reassign
endpoints). If/when staffing-managers need this worklist, widen the controller
`@Roles` and the sidebar `HANDOFFS_ROLES` to include `ADMIN` — a two-line change.

## 8. How a future developer would extend this

- **Add a new role-scoped ops view when a role is hired** (the whole point of §1): add
  a `roleGate` nav item in `StaffSidebar.tsx`, a server-gated `page.tsx`, and reuse the
  existing backend service. Do **not** revive the `/ops` portal.
- **Documents access rules live in exactly one place** — `canRoleViewDocument` in
  `backend/src/case-documents/document-priority.ts`. Change visibility there and both
  the list and the download endpoint follow automatically. To batch the cross-case
  query (see §7), rework `listAllDocumentsAcrossCases` in
  `case-documents.service.ts` — the access filter stays as-is.
- **Compliance's LIA-routing rule** is `listFlaggedCases()` in
  `compliance.service.ts`; the override event-type allowlist is
  `OVERRIDE_EVENT_TYPES` in the same file. To build the deferred routing-override /
  deadline-extension workflows, you'd first need an SLA/deadline model (none exists).
- **Handoffs staffing rules are shared, not forked** — they live in
  `OpsHandoffsService.listPendingHandoffs()`. Editing them updates both
  `/ops/handoffs` and `/staff/handoffs`. The stuck-case rules are `listStuckCases()`
  in `handoffs.service.ts`; the INZ threshold is the `INZ_AGE_THRESHOLD_DAYS` constant.
- **To build the deferred stage-transition history (Handoffs Option 2):** add a
  `CaseStageTransition` table (or emit `STATUS_CHANGED` on every `Case` stage write in
  `inz-submission.service.ts`, `visa.service.ts`, `leads.service.ts`,
  `legal-notes.service.ts`), backfill, then add a timeline surface. Everything the
  Handoffs page needs to *display* it is already structured around per-case rows.

## 9. Security layers applied

- **Server-side role gates on every new endpoint.** `GET /api/staff/compliance/*` and
  `GET /api/staff/handoffs` are `@Roles('OWNER','SUPER_ADMIN')` behind
  `JwtAuthGuard + RolesGuard`; `GET /api/staff/case-documents` is gated to the
  slot-holding + admin set. The frontend pages also server-check the session and
  redirect — defence in depth, but the API gate is the real boundary.
- **Document visibility is enforced, not cosmetic.** `canRoleViewDocument` filters the
  list **and** guards `createDownloadUrl`, so a barred role cannot fetch a
  visa-supporting document by guessing its id — the download endpoint refuses it.
- **Engagement-paid checks reuse the fail-safe SSOT.** The Handoffs "signed+paid"
  rule calls `getEngagementGateState`, which resolves to LOCKED on any error/missing
  invoice — it can never *over*-report a case as paid.
- **All three sections are strictly read-only.** No section writes to the database;
  every action (reassign, clear a flag, advance a stage) happens on the linked case
  surface with its own existing authorization. This keeps the oversight surfaces
  incapable of mutating state even if a gate were misconfigured.
- **Reused backend logic keeps one audited path.** Because Handoffs and Compliance
  reuse `OpsHandoffsService` / `ops-compliance` rather than re-implementing them, there
  is no second, unaudited code path that could drift out of policy.

## 10. Rollback instructions

No schema migration in any commit, so rollback is a plain git revert per section —
they are independent and can be reverted individually or together.

1. **Revert all three:** `git revert 9a865a3 a6899c9 dbe4b3a`. This removes the three
   `/staff` sections and their sidebar entries. The legacy `/ops/*` pages and all
   reused backend services (`OpsHandoffsService`, `ops-compliance`, the OPS documents
   queue) are untouched and keep working — nothing else depends on the reverted code.
2. **Revert only Handoffs:** `git revert 9a865a3`. Note this also removes the
   `exports: [OpsHandoffsService]` line added to `ops-handoffs.module.ts`; that export
   has no other consumer, so removing it is safe.
3. **Revert only Compliance:** `git revert a6899c9`. Independent of the other two.
4. **Revert only Documents:** `git revert dbe4b3a`. Independent; note the
   `/staff/documents` page reverts to its previous "my documents" behaviour.
5. **No data rollback needed** — nothing was written, so there is no data to undo.
