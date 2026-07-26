# Phase 22 — OPS Documents/Compliance/Handoffs: Verify + Dormant `/ops` Cleanup

End-of-phase handover for the "OPS portal remaining work" thread. The finding: all
three features (Documents, Compliance, Handoffs) were **already built** — as the
fuller Owner-dashboard `/staff/*` sections in Phase 16 — with a legacy, dormant
`/ops/*` frontend duplicating them. Per **Fork A** (the team is still just the
Owner, so `/staff/*` is the home), this phase **verified** the `/staff` sections and
**deleted** the dormant `/ops` frontend pages. No new features.

**Date:** 2026-07-26
**Commit (this phase):**
- `1c95584` — chore(ops): remove dormant /ops Documents/Compliance/Handoffs frontend (Fork A)

---

## 1. What this phase does

- **Verified** the Phase 16 Owner-dashboard sections — `/staff/documents`,
  `/staff/compliance`, `/staff/handoffs` — build clean and their data layer passes
  (see §6). These are the live home for Documents/Compliance/Handoffs.
- **Deleted the dormant `/ops` frontend** for those three (they duplicated the
  `/staff` sections and were left dormant by the Phase 16 "no separate OPS portal"
  decision): `/ops/documents` (+ the `/ops/documents/[caseId]` review drill-down),
  `/ops/compliance`, `/ops/handoffs`. Removed their now-dead items from the
  PortalLayout `ops` nav.
- **Kept** `/ops` (dashboard) + `/ops/cases`, and **all backends** — the `/staff`
  sections reuse them.
- **Deferred (Fork C)** the genuinely-remaining backlog — see §7.

**Why (the standing decision, restated):** Phase 16 deliberately did **not** build a
separate OPS portal — the team is just the Owner, so Documents/Compliance/Handoffs
live as `/staff` Owner-dashboard sections. This phase finishes that decision by
removing the leftover `/ops` duplicates. If an operations person is ever hired
(Fork B), the `/ops` pages are in git history and the backends still exist.

## 2. Files created or changed

Pulled from `git show --stat 1c95584`.

*Deleted*
- `frontend/src/app/ops/documents/page.tsx`
- `frontend/src/app/ops/documents/[caseId]/page.tsx`
- `frontend/src/app/ops/compliance/page.tsx`
- `frontend/src/app/ops/handoffs/page.tsx`

*Changed*
- `frontend/src/components/portal/PortalLayout.tsx` — removed the Documents/
  Handoffs/Compliance items from the `ops` nav + the unused `ArrowRightLeft` import.

*Untouched (deliberately)* — every backend: `ops-documents`, `ops-compliance`,
`ops-handoffs`, `case-documents`, `compliance`, `handoffs`. The `/staff` sections
reuse them (`/staff/compliance` → `GET /ops/compliance/non-compliant`;
`/staff/handoffs` → `OpsHandoffsService`; `/staff/documents` → the case-documents
layer). `/ops` (dashboard) + `/ops/cases` also stay.

## 3. Database tables / columns added

**None.**

## 4. Environment variables added (names only)

**None.**

## 5. Third-party services connected

**None.**

## 6. How to test it works

**Automated (run this phase):**
- **Data layer** — 22 backend tests green: `compliance.spec` (flagged-cases + LIA-
  routing verdict), `handoffs.spec` (staffing exceptions + stuck-case rules),
  `case-documents.cross-case.spec` + `document-priority.spec` (5-role access matrix
  + priority classification).
- **Build** — `next build` compiles cleanly; the route table shows `/staff/documents`,
  `/staff/compliance`, `/staff/handoffs` and `/ops/cases` present, and the deleted
  `/ops/{documents,compliance,handoffs}` **absent** (they now 404). No dangling
  references remain (grep of `href`/`Link`/`push` to the deleted routes is empty).

**Manual:** sign in as **OWNER** and open `/staff/documents` (cross-case docs with
source + P1/P2 badges), `/staff/compliance` (flagged cases + LIA-routing + contract
exceptions + override log), `/staff/handoffs` (unstaffed roles + stuck cases) — each
loads and functions. Visiting `/ops/documents`, `/ops/compliance`, `/ops/handoffs`
→ 404.

## 7. Known limitations / future work

- **Role gating of the `/staff` sections (important):** `/staff/documents` is broad
  staff (OWNER/SUPER_ADMIN/ADMIN/LIA/CONSULTANT/CLIENT_CONSULTANT/SUPPORT/FINANCE);
  **`/staff/compliance` and `/staff/handoffs` are OWNER/SUPER_ADMIN only** (the
  Compliance-Admin tier, by Phase 16 design). The old `/ops` pages allowed
  `OPERATIONS` + admin tier; those roles are **not** admitted to the `/staff`
  Compliance/Handoffs sections. For the current single-Owner team this is correct
  (the Owner is OWNER). If OPERATIONS/ADMIN ever need them, widening the `ALLOWED`
  set on those two pages is a one-line change (that's Fork B — standing up a real ops
  portal — which was explicitly not chosen).
- **`ops-documents` backend is now unused by any frontend** (the `/ops/documents`
  queue that consumed `GET /ops/documents/unreviewed` was deleted; `/staff/documents`
  uses `GET /api/staff/case-documents`). It was left in place (harmless, still tested)
  rather than removed in this cleanup; a future tidy-up could drop it.
- **Fork C — deferred backlog (post-launch, NOT built this phase):**
  - **SLA / deadline system** — none exists anywhere. It's the prerequisite for
    Compliance's deferred **"deadline-extension approval"** and for Handoffs to show
    true **time-in-stage** ("how long stuck in a stage") rather than just "slot empty".
  - **Stage-transition history** (Handoffs Option 2) — a `CaseStageTransition` table,
    or emitting `STATUS_CHANGED` on every CRM stage write + a backfill.
  - **Approval-gated case-routing override** (Compliance) — a formal override of an
    auto-assignment; today routing changes are ad-hoc manual reassignments (logged in
    the override/audit slice).
  These are real, net-new infrastructure and are the actual "remaining work" once the
  core three are considered done. Deferred by decision this phase.

## 8. How a future developer would extend this

- **Stand up a real OPS portal (Fork B):** the deleted `/ops/{documents,compliance,
  handoffs}` pages are in git history (`git show 1c95584^:frontend/src/app/ops/...`)
  and their backends still exist, so reviving them is restore-and-gate, not a rebuild.
  Prefer widening the `/staff` sections' `ALLOWED` sets to the ops audience over
  maintaining two parallel frontends.
- **Build the deferred backlog (Fork C):** start with the SLA/deadline model — it
  unlocks both the deadline-extension approvals and the time-in-stage handoffs. Then
  the stage-transition history, then the routing-override approval.
- The Owner-dashboard sections themselves extend as documented in their own phase
  (Phase 16): Documents access via `canRoleViewDocument`; Compliance's LIA-routing in
  `compliance.service`; Handoffs staffing rules in `OpsHandoffsService`, stuck rules
  in `handoffs.service`.

## 9. Security layers applied

- **No trust surface widened.** This phase only *removed* frontend routes; the
  surviving `/staff` sections keep their server-side gates (OWNER/SUPER_ADMIN for
  Compliance/Handoffs; the broad slot-holding set for Documents), and every backend
  endpoint enforces its own `@Roles` independently.
- **Reduced surface:** deleting the dormant `/ops` duplicates removes a second,
  less-used path to the same oversight data.
- **Backends unchanged** — no endpoint's auth or behaviour was modified, so nothing
  regressed; the 22 passing tests confirm the data layer is intact.

## 10. Rollback instructions

Frontend-only deletion, no migration — a straight git revert.

1. **Full revert:** `git revert 1c95584`. Restores the three `/ops` pages and their
   PortalLayout nav items. The backends were never touched, so the restored pages work
   immediately.
2. **Restore one page only:** `git checkout 1c95584^ -- frontend/src/app/ops/handoffs`
   (or `compliance` / `documents`), and re-add its PortalLayout nav item.
3. **No data / env / service cleanup** — there is none.
