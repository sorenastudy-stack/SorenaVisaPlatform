# PR-RECS-1 (slice 1) — persisted, client-viewable recommendation lists

Wires the already-weighted matcher (PR-OWNER-1) into a **persisted, sortable
recommendation list per Case**, generated from a resolved `MatchCriteria` via a
swappable resolver seam. Ships on the **live `/scorecard` data today** (Impl A);
the full-fidelity v2 `/assessment` drops in later without touching the list code.
**No slot selection — that's slice 2.**

**Date:** 2026-07-31
**Status:** built + verified end-to-end (unit freeze 77/77 incl. reverse-map;
integration smoke 11/11 against real crypto + DB). Matcher scoring path unchanged.

---

## 1. Why the resolver seam (the key decision)

Neither assessment flow gives a clean per-student `MatchCriteria` today:
`/scorecard` (live) stores encrypted *answers* that reverse-map to a **coarse**
criteria; `/assessment` (full-fidelity) is built but **unwired and persists
nothing**, gated on an unscheduled AI-foundation decision. So `MatchCriteria` is
made the **abstraction boundary**: the list code knows only `MatchCriteria`, never
its source. This turns a hard fork into a soft one — ship Impl A now, swap Impl B
in later as a one-line binding change.

## 2. Schema (migration `20260731120000_pr_recs_1_recommendation_lists`)

Isolated **additive** migration (approved workaround): 2 enums + 2 tables + FKs;
the parent back-relations on `Case`/`EducationProgramme` are Prisma-virtual (FK
columns live on the child tables), so **no `ALTER` on existing tables**.

| Object | Notes |
|---|---|
| enum `RecommendationListStatus` | GENERATED / VIEWED / CONFIRMED (slice 2) / SUPERSEDED |
| enum `RecommendationCriteriaSource` | SCORECARD (Impl A) / ASSESSMENT (Impl B) |
| `recommendation_lists` | per-Case, **1:many** (regeneration supersedes prior); `criteriaSource`, `criteriaJson` snapshot |
| `recommendation_items` | `rank`, `fitScore` (**frozen** — depends on Owner config), `institutionType` snapshot, `whyJson`; `@@unique([listId, programmeId])` |

**Snapshot-minimal by design:** only the volatile computed bits are frozen
(`fitScore`, `rank`, `institutionType`, `whyJson`); tuition/city/duration/intakes
are read **live** from the programme join (staff-curated, stable).

## 3. The `resolveMatchCriteria` seam + Impl A

`src/matching/criteria/`:
- `match-criteria-resolver.ts` — interface + `MATCH_CRITERIA_RESOLVER` DI token.
- `scorecard-criteria.resolver.ts` — **Impl A**: latest `ScorecardSubmission`
  (by `userId`, `isDraft:false`) → `crypto.decrypt` + `JSON.parse` (existing path)
  → reverse-map. Nationality comes from the student's **own `Contact`**
  (`Contact.userId` is `@unique`) — the submission's `leadId` is nullable, so it's
  not relied on (a bug the integration smoke caught).
- `scorecard-field-reverse-map.ts` — the documented, freeze-tested mapping.

**Reverse-map (`q16_field_main` → `qualificationFieldId`)** — 11 map 1:1; the
reviewed non-1:1 choices:

| `q16` option | → | Why |
|---|---|---|
| Healthcare & Medical | `healthcare_medical` | broadest; not nursing (a profession) |
| Business & Management | `business_management` | parent; not project_/healthcare_management; widens Q30 set safest |
| Hospitality, Tourism & Culinary | `hospitality_culinary` | operational track; not the management specialisation |
| Other / Military & Security / Religious & Theological | `null` | unresolvable / no StudyField exists — honest gap, no fabricated field |

**Three fields DELIBERATELY empty in Impl A** (a wrong hard filter is worse than a
missing soft signal): `preferredFieldIds` (`q25` lossy single → would wrongly
EXCLUDE), `desiredLevels` (no source question), `tuitionBudgetNZD` (funds-band ≠
tuition budget → would wrongly CAP OUT). `currentHighestLevel` / `gpaBand` /
`ieltsEquivalent` / `nationality` / `locationPref` map cleanly.

## 4. Service + endpoints

`RecommendationsService`:
- `generateForCase(caseId, userId)` → resolve criteria → **existing
  `matching.recommend()`** (already applies the Owner institution weighting) →
  supersede prior active list → persist new list + item snapshots → emit
  `RECOMMENDATION_LIST_GENERATED` (`CrmEvent`, the existing domain-event queue).
- `getCurrentForCase(caseId, sort, markViewed)` → latest active list + items joined
  to live programme data, sorted (default/tuition/startDate/duration/city/featured
  per PRD_4 §7/§13), flips GENERATED→VIEWED on the client's read.
- `resolveCaseIdForStudent(userId)` — server-side `User→Contact→Lead→Case` (never
  trusts a client-supplied caseId).

Endpoints:
- `POST /student/recommendations/generate` · `GET /student/recommendations?sort=`
  — `JwtAuthGuard + Roles('STUDENT') + EngagementPaidGuard` (the admission-form stack).
- `GET /staff/cases/:caseId/recommendations?sort=` — OWNER/SUPER_ADMIN/ADMIN/
  CONSULTANT/CLIENT_CONSULTANT (Admission-Specialist visibility; no `markViewed`).

## 5. Verification

- Backend build clean; **matching + scoring gate 77/77** (scoring golden, matcher
  golden, matcher units, + the new reverse-map freeze).
- **Reverse-map freeze** (`scorecard-field-reverse-map.spec.ts`) pins the full
  table + `buildCriteriaFromScorecardAnswers` output (representatives, deliberate
  empties, `Flexible`/`No test taken`/unmapped-key fail-safes).
- **Integration smoke 11/11** (temp, against real crypto + DB): resolver decrypts a
  real submission → correct criteria; generate persists list+item with frozen
  fitScore + `UNIVERSITY` snapshot; regenerate supersedes (exactly one active);
  getCurrent joins/sorts + flips VIEWED. Fixture cleaned up.
- Pre-existing 7-suite failures unchanged/unrelated (proven at HEAD baseline in
  PR-OWNER-1).

## 6. Flags / follow-ups

- **C fast-follow (recommendation quality).** Impl A's coarseness is contained but
  real: no `preferredFieldIds`/`desiredLevels`/budget, and the three ambiguous
  buckets (Business & Management, Healthcare & Medical, Hospitality) collapse to a
  broad representative. Per Yashua: a lightweight **"confirm your specific field"
  nudge** on exactly those buckets — plus adding real desired-level / multi
  preferred-field / NZD-budget questions to the **live `/scorecard`** — would
  resolve the coarseness precisely without redesigning anything. Worth prioritising
  reasonably soon rather than letting it linger.
- **Frontend (shipped).** Student-portal page at `/student/recommendations`
  (`RecommendationsClient.tsx`) — read-only ranked list + sort (Best match /
  tuition / start / duration / city / featured), navy/gold palette, mobile-first,
  one primary action ("Find my matches") on the empty state. Handles the
  engagement-paid gate (403 → calm "unlock after payment" panel). Nav item added
  to the client shell (payment-locked, inline label so Persian stays frozen).
  Slot-selection UI is NOT here (slice 2).
- **Impl B (v2 `/assessment`).** Drops in behind `MATCH_CRITERIA_RESOLVER` when
  `/assessment` goes live — but needs **new per-student v2 persistence** first
  (the v2 flow currently saves nothing).

## 7. Next — slice 2 (NOT started)

The 5-slot picker + confirmation: mandatory Polytechnic/College enforcement at the
API (reusing the frozen `assignPrioritySlots`), lock-on-confirm, and the
`PRIORITY_SLOTS_CONFIRMED` event (→ `CrmEvent`, PENDING, for a future SOP
generator). Its mandatory-enforcement rule is a product-safety control — freeze-test
it and checkpoint before building, same discipline as here.
