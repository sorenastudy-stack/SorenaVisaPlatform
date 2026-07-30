# PR-RECS-2 (slice 2) — priority-slot selection (PRD_4 §8)

The 5-slot picker: auto-fill → Admission-Specialist review/swap → client reorder →
confirm-and-lock, with the mandatory Polytechnic/College safety net enforced on
**every** write path. Backend + endpoints (no frontend this slice).

**Date:** 2026-07-31
**Status:** built + verified. Safety validator frozen (two-directional golden
battery) and committed before wiring; full-flow integration smoke 14/14.

---

## 1. Flow (corrected from the initial proposal)

`assignPrioritySlots` auto-fills the 5 slots → the **Admission Specialist (staff)**
may **swap** which programme sits in a position → the **client** may only
**reorder** the finished set into their priority sequence → **confirm** locks it.
The client never adds/removes/substitutes programmes — that's staff-only.

## 2. The safety model — suggestion vs. enforcement

`assignPrioritySlots` (PR-OWNER-1) only *suggests* a slate once. **`validateSlotSelection`
is the enforcement gate**, and it runs on **every** write path, because a
permutation preserves the programme *set* but **not** per-position type rules:
swapping the mandatory-ITP slot with a PTE slot drops a College into the
Polytechnic safety slot. **Verified counterexample** — a set-preserving slot 3↔4
swap yields `MANDATORY_WRONG_TYPE` at position 4; the earlier "reorder can't break
mandatory slots" intuition was **false**, so reorder is not a validation-exempt
fast path.

- `institutionType` is **always resolved server-side** from the programme's
  provider — never the client's claim; null/unknown fails closed.
- **Two-directional freeze battery** (`priority-slots.validate.spec.ts`), equal
  weight: **wrongly-ALLOWED rejected** (mandatory wrong-type incl. the reorder
  hole, mandatory-empty, disallowed-type, duplicate, bad-count, unresolved-type)
  AND **wrongly-BLOCKED accepted** (canonical valid, preferred-is-only-a-hint,
  non-mandatory-empty, valid same-type reorders, live-rule relaxation). Exact
  `{position, code}` assertions, frozen before wiring (commit `0b4ffbf`).

## 3. Write-path asymmetry (intentional)

| Path | Guard | Validation |
|---|---|---|
| `PUT /staff/cases/:caseId/priority-slots` (swap) | CONSULTANT/admin tier | **Changed position only** — staff *build* the slate incrementally; unrelated incomplete slots don't block, but a type violation at the swapped position is rejected with structured errors |
| `PUT /student/priority-slots/reorder` | STUDENT + engagement-paid | **Set-equality** (may only permute, not change which programmes) **+ full `validateSlotSelection`** (a permutation must land entirely valid — catches the mandatory-slot hole) |
| `POST /student/priority-slots/confirm` | STUDENT + engagement-paid | **Full `validateSlotSelection`** — the final gate regardless of who last edited; on pass → `status=CONFIRMED`, `confirmedAt`, emit `PRIORITY_SLOTS_CONFIRMED` |
| `GET` (student + staff) | resp. STUDENT / CONSULTANT-tier | auto-seeds the draft from `assignPrioritySlots` on first access |

Errors are returned structured (`{position, code}`) so the UI can highlight the
offending slot. `caseId` is server-resolved for student paths (never client-supplied).

## 4. Schema (migration `20260731140000_pr_recs_2_priority_slots`)

Isolated additive: new `priority_slots` table (children of `RecommendationList`;
`@@unique([recommendationListId, position])`) + one nullable `confirmedAt` column
on `recommendation_lists`. **Reuses `RecommendationList` as the container** — its
status drives the lock (`GENERATED`/`VIEWED` = editable, `CONFIRMED` = locked). The
slot rules + `institutionType` are **read live** (never snapshotted onto the slot),
so the safety checks always use authoritative current data; the immutable
"rules enforced + choices made" audit is the `PRIORITY_SLOTS_CONFIRMED` event
payload.

## 5. Event

`PRIORITY_SLOTS_CONFIRMED` via `EventsService.emit` → `CrmEvent` (payload =
`listId`, `slotCount`, `enforcedRules`, `selection`), same pattern as
`RECOMMENDATION_LIST_GENERATED`. **Nothing consumes it yet** — SOP generation and
Admission-Specialist notification are unbuilt; this is the logged anchor for them.

## 6. Verification

- Matching + scoring gate **90/90** (incl. the 13-case slot-validate freeze).
- **Integration smoke 14/14** (real DB, then cleaned up): auto-seed fills mandatory
  slots (4=ITP, 5=PTE); staff University→slot-4 **rejected** (`MANDATORY_WRONG_TYPE`)
  + valid swap ok; client set-change **rejected**, reorder-into-mandatory-hole
  **rejected** (`MANDATORY_WRONG_TYPE`), valid same-type reorder ok; confirm locks +
  emits the event; post-confirm staff-swap / client-reorder / re-confirm all
  **rejected**.
- Backend build clean.

## 7. Decisions applied

Container = reuse `RecommendationList` · non-mandatory slots (1–3) optional at
confirm · **confirm locks the order too** (no client self-unlock; a staff reopen is
a future action) · `confirmedAt` column added · auto-seed on first GET (the slate
the Specialist reviews before the client sequences it).

## 8. Flags / next

- **No frontend this slice.** Two screens are the natural next UI: the Specialist's
  slot-review/swap panel (staff case detail) and the client's reorder/confirm
  screen (student portal). Endpoints are ready.
- **Staff "reopen after confirm"** — deliberately out of scope; if a confirmed
  selection must change, that's a future staff action (would flip `CONFIRMED` →
  `VIEWED`, audited).
- **Downstream of confirm** — Sequential Submission (submit Slot 1 → wait → Slot 2)
  and SOP/CV generation listen for `PRIORITY_SLOTS_CONFIRMED`; both are separate,
  larger builds.
