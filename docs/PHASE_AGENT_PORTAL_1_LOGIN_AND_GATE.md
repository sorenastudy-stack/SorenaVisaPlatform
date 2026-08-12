# Phase — Agent Portal 1: login and the access gate

**Date:** 13 August 2026
**Route:** `/agent`
**Phase 0 (foundations):** `2ad9ae4`, `458e6c5`, `a094652`

> Naming: the numbered phase docs stopped at 39. This follows the multi-phase family
> convention already used by `PHASE_LIA_1_*`, `PHASE_CONSULT_1_*` and `PHASE_SCORECARD_1_*`.

## 1. What this phase does

An external agent can sign in, and sees nothing until Sorena says so.

Two things had to be true at once for that to be worth building. An agent needs a way in —
they are not staff and not a client, and no surface existed for them. And an agent must not
be able to *use* that way in until they are both **verified** and **under contract**, because
the whole point of onboarding an agent is that somebody checked who they are before they
started introducing strangers to an immigration business.

So this phase is a login and a wall, plus the two read-only screens behind the wall: the
clients an agent introduced, and the commission owed to them. Nothing else. Contract
signing, document upload, the stats dashboard and anything touching visa outcomes are
later phases.

**The contract half has no flow yet.** Until phase 3 wires DocuSeal, an Owner can clear it
by hand — with a reason, audited as its own event, and marked as an override so it never
reads as a signature. §7 covers why that was chosen over the alternatives.

## 2. Files created or changed

**Added — the portal**
- `backend/src/agents/agent-access.helper.ts` — the gate, as one function
- `backend/src/agents/agent-access.guard.ts` — the gate, as a guard
- `backend/src/agents/agents.service.ts` — leads and payables, filtered to the caller
- `backend/src/agents/agents.controller.ts` — three routes
- `backend/src/agents/agents.module.ts`
- `backend/src/agents/agents.spec.ts` — 17 tests
- `frontend/src/app/agent/layout.tsx`, `page.tsx`, `payouts/page.tsx`
- `frontend/src/components/agent/AgentShell.tsx` — shell + blocked state
- `frontend/src/components/agent/AgentLeadsClient.tsx`
- `frontend/src/components/agent/AgentPayablesClient.tsx`

**Added — the Owner side**
- `backend/src/marketing/dto/clear-agent-contract.dto.ts`
- `frontend/src/components/staff/marketing/AgentPortalAccessCard.tsx`
- `backend/prisma/migrations/20260813093000_agent_portal_contract_gate/`

**Changed**
- `backend/prisma/schema.prisma` — five contract columns; a disambiguating comment on
  `SubmissionMethod.AGENT_PORTAL` (§7)
- `backend/src/marketing/affiliate-agents.service.ts` — `create()` provisions a login;
  `clearContract()`; `AgentDetail` gained `portalAccess`
- `backend/src/marketing/marketing.controller.ts` — `PATCH agents/:id/clear-contract`
- `backend/src/app.module.ts` — registers `AgentsModule`
- `frontend/src/app/staff/marketing/agents/[id]/page.tsx` — mounts the access card

## 3. Database tables/columns added

One additive migration, `20260813093000_agent_portal_contract_gate`, on `affiliate_agents`:

| Column | Purpose |
|---|---|
| `contractSignedAt` | the fact the gate reads |
| `contractIsManualOverride` | `true` when a human cleared it rather than the agent signing |
| `contractClearedById` / `contractClearedByName` | who did it, name snapshotted |
| `contractClearedReason` | why — required at the service boundary |

Nothing dropped or re-typed. The one NOT NULL column carries a default, so every existing
row is valid the moment it runs.

`contractClearedReason` is nullable in the database but required in the service. The
database cannot express "required only when this is an override", and a NOT NULL would
break the phase-3 path that sets `contractSignedAt` from a real signature with no reason
at all.

## 4. Environment variables added

**None.**

## 5. Third-party services connected

**None.** Magic-link sign-in reuses `MagicLinkService` exactly as it stands — no change was
needed, because it already keys off any active `User` rather than a particular role.

## 6. How to test it works

1. Owner creates an agent with an email at `/staff/marketing/agents`. A `User` with role
   `AGENT` is created in the same transaction.
2. That agent requests a sign-in link and lands on `/agent`. They see the wall, naming what
   is outstanding — expect both halves listed.
3. Owner verifies the agent's documents → the wall drops to one outstanding item.
4. Owner clears the contract with a reason → the agent reloads and sees their clients and
   commission.
5. `npx jest src/agents/` — 17 tests over the gate truth table, fail-closed paths, and
   cross-agent isolation.

Proven locally end to end with a fully onboarded fixture agent: `/agent/me` returns the
gate state, `/agent/leads` and `/agent/payables` return that agent's own rows only.

### The `@Roles('STUDENT','AGENT')` surface — measured, not reasoned about

An `AGENT` role already existed and was already named on ~50 `students/me/*` routes,
inherited from an older agency-counsellor idea. Phase 1 is what makes an `AGENT` user
actually exist, so that surface had to be checked with a real token rather than argued
about from the guards.

21 routes called with a genuine, fully onboarded AGENT token — 4 reads and 17 mutations
(empty bodies; nothing was created):

```
21 shut, 0 leaked
  20 × 403  EngagementPaidGuard — no case, so no engagement invoice, so locked
   1 × 404  "Student profile not found" — Contact.userId resolves to nothing
```

Two independent layers, both failing closed, neither of which needed changing. The agent's
own three routes answered 200 in the same run, so the audit distinguishes "shut" from
"broken".

## 7. Known limitations

**The contract half is an override until phase 3.** Options were: let the Owner mark it by
hand, drop the condition until DocuSeal lands, or ship with no agent able to pass at all.
The override was chosen because it exercises the real two-condition gate — the alternative
would have left the second half untested until the phase that depends on it. The cost is a
column that can be set without a contract existing, which is why it is flagged, reasoned,
attributed and audited rather than silently set.

**`EngagementPaidGuard` says the wrong thing to an agent.** The 403 above reads *"Your full
access opens once we confirm your payment"* — accurate for a client, meaningless to an
agent who will never have a payment. Not a leak and not this phase's surface, but the words
are wrong for the caller now receiving them.

**`AgentProfile` is still dead.** 0 rows, no code references, semantics from a different
idea (agency counsellor, not affiliate). Deliberately not reused here — reusing a dead
model with the wrong meaning is how `Application`/`Commission` drifted. It should be
deleted in its own change.

**Agents created before this phase have no login.** `userId` is null on them; production
has none, so nothing to backfill today.

**An agent with no email gets no login.** The Owner's form allows it, and the access card
says so rather than failing silently.

**Naming collision, deliberately left alone.** `SubmissionMethod.AGENT_PORTAL` means an
application lodged with an institution *through a third-party agent/aggregator portal* — it
has nothing to do with this feature. Six references, all in the admission-submission path.
Renaming would need a migration and a data rewrite to fix a grep annoyance, so the enum
member now carries a comment saying exactly this, which is where a future grep lands.

## 8. How a future developer would extend this

**Phase 2** (Owner-side rate and contract management) and **phase 4** (stats) add screens
over data that already exists. **Phase 3** (DocuSeal) writes `contractSignedAt` and leaves
`contractIsManualOverride` false — that is the whole reason the flag exists.

**Add a condition to the gate in `agent-access.helper.ts` and nowhere else.** The guard, the
status endpoint and the Owner's access card all read that one function. Phase 0 shipped the
same rule written out twice — once in a cron, once in a booking filter — and one copy was
wrong for twelve hours of every day. One definition is not tidiness here; it is the fix for
a bug this feature already had.

**Do not add a `?agentId=` parameter to anything in `AgentsService`.** The agent id comes
from the guard, which got it from the JWT. A parameter is how "their own data" stops
meaning anything.

## 9. Security layers applied

**Authentication, then role, then gate — three questions, three layers.** `JwtAuthGuard`
(are you anybody), `@Roles('AGENT')` (may you ask), `AgentAccessGuard` (may you do anything
yet). The third is per-route rather than class-level so `/agent/me` can answer for a blocked
agent; an agent who cannot get in still has to be told why.

**The gate fails closed.** No user id, no agent record, a paused or terminated agent, or
anything unexpected produces `allowed: false`. Nothing in the helper throws — both callers
need a state rather than an exception.

**Pausing overrides everything.** An agent who was verified and contracted before being
paused is still paused; the status check runs before the other two.

**Ownership is resolved from the JWT and applied unconditionally.** `AgentsService` takes
the agent id the guard resolved, and no method accepts anything that could widen it. Proven
by removing the filter: the cross-agent test fails immediately.

**A blocked agent learns nothing about the business.** `/agent/me` returns six fields — name,
the three gate booleans, the override flag, and the outstanding reasons. No clients, no
counts, no amounts. A count would tell a blocked agent exactly how much is waiting.

**The 403 does not say which half is missing.** The detail belongs to `/agent/me`; an error
string is the wrong place to enumerate what a caller has not satisfied. Asserted by test.

**Provisioned accounts have no usable password.** 48 random bytes go into `passwordHash`, so
no input can ever match. Magic link only.

**One email is one person.** `provisionLogin` reuses an existing `User` rather than minting a
second, and refuses if that account already belongs to another agent — otherwise the 1:1
constraint on `AffiliateAgent.userId` would be enforcing nothing.

**The override is OWNER-only, twice.** `@Roles('OWNER')` on the route and a re-check in the
service, so the rule does not depend on the route shape. The reason is required, and the
event is written as `AGENT_CONTRACT_MANUALLY_CLEARED` — its own type, not folded into a
generic update, because a human bypassing a control should be findable as that.

**The page-level redirect is convenience.** `/agent/layout.tsx` bounces non-AGENT sessions,
and staff roles are not admitted. The boundary is the API.

**No new secrets, no new third-party service, no new env var.**

## 10. Rollback instructions

Revert the code. The five columns stay behind, unused and harmless — `contractSignedAt`
null on every row means the gate would refuse everyone if the code came back without them
being re-set, which is the safe direction.

If the migration itself must go, drop the five columns in a follow-up migration. Nothing
else reads them. Any row where `contractIsManualOverride` is true carries a human decision
and its reason — capture those rows before dropping, or the record of who was let in
without a contract goes with them.

Reverting does **not** delete provisioned `User` rows. They keep `role: 'AGENT'` and no
usable password, and with the portal gone they can sign in to nothing. Deleting them is
optional and separate; `AffiliateAgent.userId` is `SET NULL` on user delete, so removing an
account never takes the agent record or anything owed to it.
