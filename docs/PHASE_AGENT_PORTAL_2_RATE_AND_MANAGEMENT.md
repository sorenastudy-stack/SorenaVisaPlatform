# Phase — Agent Portal 2: rate write path and agent management

**Date:** 17 August 2026
**Status:** built and verified
**Scope:** deliberately excludes anything needing DocuSeal. Nothing here pre-commits a phase-3
decision.

## 1. What this phase does

`AffiliateAgent.commissionRatePercent` existed, the payables deriver read it
(`?? AGENT_COMMISSION_RATE_PERCENT`), and **nothing in the application could write it**. Not in
a DTO, not on a screen. Every agent silently earned the company default, and an Owner had no
way to agree a different rate with anybody. This is the same class of gap as `institutionType`:
a column with a reader and no writer.

It also gives the Owner a usable agent screen. The list showed name, email, status, links and
leads — nothing about money, verification or contract — so answering "what is this agent on?"
meant opening records one at a time, and for the rate was impossible at any depth.

## 2. Files created or changed

**Created**
- `backend/src/marketing/dto/set-agent-rate.dto.ts`
- `frontend/src/components/staff/marketing/AgentRateCard.tsx`
- `frontend/src/components/staff/marketing/AgentHistoryCard.tsx`
- `backend/prisma/migrations/…_drop_dead_agent_profile/migration.sql`

**Changed**
- `backend/src/marketing/affiliate-agents.service.ts` — `setRate()`, `history()`, list/detail shape
- `backend/src/marketing/marketing.controller.ts` — `PATCH agents/:id/rate`, `GET agents/:id/history`
- `frontend/src/app/staff/marketing/agents/page.tsx` — rate / verified / contract columns
- `frontend/src/app/staff/marketing/agents/[id]/page.tsx` — the two new cards
- `backend/prisma/schema.prisma` — `AgentProfile` removed
- `docs/PHASE_AGENT_PORTAL_1_LOGIN_AND_GATE.md` — a stale limitation corrected (§7)

## 3. Database changes

**One destructive migration, in its own commit:** `agent_profiles` dropped. No additive change
— every column this phase writes already existed.

## 4. Environment variables

**None.** `AGENT_COMMISSION_RATE_PERCENT` is a code constant (10) and is unchanged.

## 5. Third-party services

**None.** That is the point of this phase.

## 6. How to test it works

Owner walkthrough against a running server, **16/16**:

1. A new agent has no per-agent rate and resolves to the company default (10%).
2. A negative rate and 150% are both rejected.
3. An **ADMIN** attempting to set a rate gets **403** — the role is re-checked in the service,
   not merely on the route.
4. The Owner sets 17.5%; it persists and appears on the list with the "default" marker gone.
5. An `AFFILIATE_AGENT_RATE_CHANGED` audit row is written carrying **both** old and new.
6. The history endpoint renders it as *"Commission rate changed from the company default to
   17.5%."*
7. Clearing the rate restores the default (null → effective 10).
8. **0% is stored as a real rate**, distinct from blank.

The test agent and its audit rows were removed afterwards.

## 7. Known limitations

**No signed contract state exists yet.** `contractState` is derived as
`NONE | MANUAL_OVERRIDE | SIGNED`, and `SIGNED` is currently unreachable — nothing can set
`contractSignedAt` except the Owner override, which also sets `contractIsManualOverride`. It is
derived honestly anyway rather than collapsed into `MANUAL_OVERRIDE`, because phase 3 writes
exactly that state, and a UI that had been told overrides and signatures look identical would
then be wrong about real contracts.

**The rate is freely editable, deliberately.** Phase 3's decision 5 locks it once a contract is
*signed*. Nothing is signed, so there is nothing to lock, and implementing the lock now would be
guarding a state that cannot occur. The place it will go is `setRate()`, in one method.

**No rate history beyond the audit log.** Old → new is recorded per change and rendered, but
there is no first-class rate-history table. The audit rows answer the question; a table would
be the phase-3 concern if `AgentContract` needs to point at one.

**Production has zero agents.** Everything here is verified against dev fixtures and a real
server, but nothing in this feature has met a real user.

**A correction carried from the state-check.** That state-check reported the
`EngagementPaidGuard` agent wording as still broken. It is not, and has not been since
`97cdd00`: the guard is role-aware and an AGENT gets *"This is a client area. Your agent
dashboard is at /agent."* The error was quoting the phase-1 doc's limitations list as current
fact without reading the code — the code had been fixed and the doc had not. Nothing regressed
and nothing was reapplied. The phase-1 doc now marks that item resolved and says why the
paragraph was left visible.

## 8. How a future developer would extend this

**Phase 3 hooks into `setRate()` and nowhere else.** When a signed contract exists, the lock
belongs at the top of that one method — the same rule as `agent-access.helper.ts`: one
definition, because the alternative is two copies that disagree.

**Null is not zero, and this will be tempting to "simplify".** Null means no per-agent rate was
agreed, so the company default applies; 0 means one was agreed and it is nothing. Collapsing
them would silently move money. The DTO allows null explicitly, the service branches on it, and
the UI says so in the helper text.

**The history reads audit rows — do not add a parallel store.** If a new agent event is
introduced, emit an audit row with `entityType: 'AFFILIATE_AGENT'` and add a case to
`summariseAgentEvent`; it appears in the UI with no other change.

## 9. Security layers applied

**Owner-only, twice.** The route carries `@Roles('OWNER')` and `setRate()` re-checks
`actor.role` itself. A decorator is the kind of thing a refactor drops; for the field that
decides what a person is paid, the check that matters is the one next to the write. Proven with
a real ADMIN token — 403.

**Bounds validated twice** for the same reason: at the DTO (0–100, ≤2dp, rejects negative) and
again in the service, which is reachable from any future caller.

**Audited with old and new.** `AFFILIATE_AGENT_RATE_CHANGED` carries `oldValue` as well as
`newValue`, plus the actor's name and role snapshotted, so the trail survives the actor being
renamed or deleted.

**Not retroactive.** `AgentPayable` snapshots its rate at derivation, so changing a rate never
restates what an agent has already been told they are owed — the principle the payables ledger
was built on.

**The destructive migration refuses to run on non-empty data.** The `agent_profiles` drop
raises rather than deleting if a row exists.

## 10. Rollback instructions

Two commits, revertible independently and in either order.

**The rate/UI commit:** revert it. The column returns to being unwritable; any rate already set
stays in the database and keeps being honoured by the payables deriver, because that reader was
never changed.

**The `AgentProfile` drop:** revert restores the model in `schema.prisma`, but the table is
gone. Recreate it with `prisma migrate diff` against the restored schema. There is no data to
restore — it was empty in every environment.
