# Phase 23 — Institutional/Provider Commissions Ledger + Sales-Stub Cleanup

End-of-phase handover for the Sales-portal thread. The finding: the `/sales/*`
portal was a dormant admin-shell of empty stubs; the underlying **institutional
commission** backend already existed. This phase built an Owner-dashboard
**Commissions ledger** at `/staff/commissions` over that existing model, and deleted
the dormant `/sales/*` stubs.

**Scope boundary (critical):** "Commissions" here means **institutional / provider
revenue** — commission Sorena EARNS from universities/education providers after a
student enrolls. The **agent-recruitment commission** Sorena would PAY OUT to
independent agents is a **separate model, separate money-flow direction, and is
entirely out of scope** (see §7). No schema, UI, or placeholder fields for it were
added.

**Date:** 2026-07-26
**Commit (this phase):**
- `a5f5d10` — feat(commissions): institutional/provider commission ledger at /staff/commissions

---

## 1. What this phase does

- Built **`/staff/commissions`** (OWNER + FINANCE + SUPER_ADMIN) — a ledger over the
  existing `Commission` model (per-enrolment `Application`; provider + programme;
  `estimatedAmountNZD`/`actualAmountNZD`; lifecycle **ESTIMATED → CONFIRMED →
  INVOICED → PAID / CANCELLED**; renewal reminders):
  - **List** with filters by **status** and **provider** (provider options derived
    from the ledger itself — no separate catalog fetch, since FINANCE isn't admitted
    to the providers endpoint).
  - **Record-a-commission** modal: pick the student's **case** → its **application**
    (programme) → enter type / rate / year / estimated amount → `POST /commissions`.
  - **Lifecycle actions** per row — Confirm, Mark invoiced, Mark paid, Cancel —
    driven by the service's transition map (only valid next moves are shown).
  - **Renewal reminders** — a banner + per-row "due" flag when
    `renewalReminderDate ≤ today` and not yet sent / not terminal.
  - Everything labelled **institutional / provider revenue** so it's unambiguous once
    the agent-commission side is added later (the old `/sales/commissions` stub
    mislabeled this as "your commission ledger / payout status").
- **Reused `CommissionsService` as-is** (no business-logic change). Only the **role
  gates** were aligned (see §9).
- **Deleted** the dormant `/sales/{pipeline,consultations,commissions}` stubs +
  cleaned the sales nav; kept the functional `/sales/leads` + `/sales` dashboard.

## 2. Files created or changed

Pulled from `git show --stat a5f5d10`.

*Created*
- `frontend/src/app/staff/commissions/page.tsx` — gated page.
- `frontend/src/components/staff/commissions/CommissionsClient.tsx` — the ledger UI +
  record modal.
- `backend/src/commissions/commissions.lifecycle.spec.ts` — DB-backed spec (5 tests).

*Changed*
- `backend/src/commissions/commissions.controller.ts` — role-gate alignment.
- `backend/src/commissions/commissions.service.ts` — role-gate alignment
  (confirm/reminder internal checks + `VIEW_ROLES`); **no logic change**.
- `frontend/src/components/staff/shell/StaffSidebar.tsx` — "Commissions" nav item.
- `frontend/src/components/portal/PortalLayout.tsx` — removed the 3 sales-nav stubs +
  unused `Calendar`/`DollarSign` imports.

*Deleted*
- `frontend/src/app/sales/{pipeline,consultations,commissions}/page.tsx`.

## 3. Database tables / columns added

**None.** The `Commission` model + `EducationProvider` Y1/Y2 rates already existed;
this phase only surfaces them. **No agent-commission schema was added.**

## 4. Environment variables added (names only)

**None.**

## 5. Third-party services connected

**None.**

## 6. How to test it works

**Automated** — `commissions.lifecycle.spec.ts` (DB-backed, 5/5 green): the full
create (ESTIMATED) → confirm (sets `confirmedAt` + a ~1-year `renewalReminderDate`) →
invoiced (`invoiceSentAt`) → paid (`paidAt`) lifecycle; an invalid transition
(ESTIMATED → PAID) is rejected; and the gating — OWNER/FINANCE (+SUPER_ADMIN) can
confirm / view / update reminders, other roles are refused. Backend `tsc` + `next
build` clean; `/staff/commissions` builds and the deleted `/sales` routes 404.

**Manual (end-to-end):**
1. Sign in as **OWNER** → **Commissions** in the sidebar → `/staff/commissions`.
2. **Record** a commission: click "Record commission" → pick a case → pick its
   application → enter type/rate/year → Record. It appears with status **ESTIMATED**.
3. **Confirm** it → status **CONFIRMED**, a **renewal reminder** date (~1 year out)
   appears; the reminder banner counts it once due.
4. **Mark invoiced** → **INVOICED**; **Mark paid** → **PAID** (terminal).
5. **Filter** by status and by provider.
6. Sign in as **FINANCE** → you can view the ledger + run the money lifecycle
   (confirm/invoice/pay) + reminders, but **not** "Record" (that button is
   OWNER/SUPER_ADMIN — see §9). Sign in as any **other role** → `/staff/commissions`
   redirects to `/staff`; `GET /commissions` returns 403.
7. Visit `/sales/pipeline`, `/sales/consultations`, `/sales/commissions` → 404.

## 7. Known limitations / future work

- **Agent-recruitment commissions are OUT OF SCOPE — a dedicated future phase.**
  This phase covers ONLY stream 1 (institutional/provider revenue Sorena *earns*).
  Stream 2 — commission Sorena *pays out* to independent agents who recruit students —
  is a **separate model with the opposite money-flow direction**. It was deliberately
  **not** built, and **no placeholder schema/fields/UI** were added for it, to avoid
  conflating the two. It will be scoped separately with full requirements. When it
  lands, the `/staff/commissions` labelling ("institutional / provider revenue")
  keeps the two unambiguous.
- **Recording is OWNER/SUPER_ADMIN, not FINANCE.** Creating a commission reads the
  enrolment applications (`GET /applications/:caseId`) + cases, which are
  admissions-tier gated and exclude FINANCE. This maps to the real workflow (OWNER/
  admissions records the commission when an enrolment confirms; FINANCE runs the money
  lifecycle) — but if FINANCE ever needs to record, the applications/providers
  endpoints would need widening (a separate cross-module gating change).
- **Estimated/actual amounts are entered, not computed.** The provider `Y1/Y2` rates
  on `EducationProvider` are not auto-applied to compute `estimatedAmountNZD`; the UI
  captures type/rate/estimate manually. Auto-calc from provider rates is a possible
  enhancement.
- **Commissions are created manually**, one per enrolment `Application` (guarded
  unique). There is no auto-creation hook on enrolment confirmation.
- **No CSV/export or aggregate reporting** on the ledger yet (the dashboard already
  sums estimated/confirmed/paid totals separately).

## 8. How a future developer would extend this

- **Add auto-calc:** in the record modal, once an application (→ provider) is chosen,
  fetch the provider's `commissionY1Value`/`Y2Value` and pre-fill type/rate/estimate.
- **Auto-create on enrolment:** hook `createCommission` off the application status
  transition to `OFFER_ACCEPTED`/enrolment (the model + guard already prevent
  duplicates).
- **Agent-commission (stream 2):** build as its own model (payable, per-agent, opposite
  direction) and its own surface — do NOT overload the `Commission` model. The ledger
  labelling is already scoped to "provider revenue" to make room for it.
- All lifecycle logic lives in `CommissionsService` (transition map,
  `confirmedAt`/reminder, `invoiceSentAt`/`paidAt`); the UI only calls it.

## 9. Security layers applied

- **Money-managing tier gate.** All commission routes are `@Roles('OWNER',
  'SUPER_ADMIN', 'FINANCE')` **except** create (`POST /commissions` → OWNER/
  SUPER_ADMIN, since it reads admissions data). The service enforces the same
  independently: `VIEW_ROLES` + internal checks in `confirmCommission` /
  `updateReminderDate` were aligned to OWNER/SUPER_ADMIN/FINANCE (replacing the legacy
  OPERATIONS-centric gates — OPERATIONS is being retired and no active frontend
  consumed these routes). **Business logic is unchanged.**
- **Ledger reads are audited.** `findAll` writes a `COMMISSIONS_LEDGER_VIEWED` audit
  row on every read (money-touch → audit), unchanged from before.
- **No per-user leakage risk:** commissions have no per-user owner (they hang off
  application → provider), so the gate is a role gate, not per-user scoping — the
  entitled tier sees the whole ledger, everyone else is refused (page redirect +
  API 403).
- **Reduced surface:** the dormant `/sales` stubs were removed. The `SALES` role
  definition itself (schema/gates) was left untouched, per instruction.

## 10. Rollback instructions

No schema migration — a straight git revert.

1. **Full revert:** `git revert a5f5d10`. Removes `/staff/commissions` + its nav item,
   restores the 3 `/sales` stubs + their nav items, and reverts the commission role
   gates to their prior (OPERATIONS-centric) state. The `Commission` model + service
   logic were never structurally changed, so nothing else regresses.
2. **Partial (keep the ledger, restore /sales stubs):** `git checkout a5f5d10^ --
   frontend/src/app/sales frontend/src/components/portal/PortalLayout.tsx`.
3. **Partial (revert only the gate alignment):** restore the prior `@Roles` +
   internal role arrays in `commissions.controller.ts` / `commissions.service.ts` —
   note this would 403 OWNER/FINANCE on confirm/reminder and break the new UI's
   actions, so only do this alongside reverting the UI.
4. **No data / env / service cleanup** — there is none.
