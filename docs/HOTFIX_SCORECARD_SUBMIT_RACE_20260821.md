# HOTFIX — Scorecard submit crashed when two submits shared one reused Lead

**Date:** 21 Aug 2026 (implemented 22 Aug)
**Branch:** `fix/scorecard-submit-race-condition`, off `415c8f4`
**Migration:** none — application logic only

## 1. What happened

Visitors finishing the Readiness Assessment saw **"An unexpected error occurred. Please try again."** on the final *Submit assessment* step — for a submission that had, in fact, already gone through seconds earlier. The underlying error was a raw, unhandled `PrismaClientKnownRequestError`: *Unique constraint failed on the fields: (`leadId`)*, thrown from inside `ScorecardService.submitScorecard`'s transaction and rendered by the global exception filter as the generic message.

## 2. Root cause

Not a defect in PR #4 — a consequence of it that nothing accounted for.

PR-SCORECARD-ATTR-1 made the submit transaction **reuse** an existing Lead for a contact rather than always creating a new one:

```ts
const existingLead = await tx.lead.findFirst({ where: { contactId }, ... });
```

That is the correct behaviour, and it is what puts a Webinar registrant and their later Scorecard on one profile instead of two.

The consequence: two near-simultaneous submits for the same person now legitimately resolve to the **same** Lead. Each still creates its **own** `ScorecardSubmission` row, and each tries to claim that one Lead as its own `leadId`. That column is `@unique` (`schema.prisma:50`), so exactly one can win. The loser threw.

A double-click on *Submit assessment* is the likely trigger; any near-simultaneous repeat (slow connection, an eager retry) does the same thing.

The important observation is that the losing request is **not a failure to report** — it is a duplicate of one that already succeeded. It was being treated as the former.

## 3. The fix

`runSubmitScorecardTransaction(userId, run)` wraps the existing transaction. On a `P2002` naming `leadId`, it looks up the visitor's most recent committed (`isDraft: false`) submission and returns that instead of throwing.

Deliberately narrow, because recovering from an error sits one line away from swallowing errors that deserve to be seen:

| Situation | Behaviour |
|---|---|
| P2002 on `leadId`, earlier submission found | Recovers — returns the committed submission |
| P2002 on `leadId`, **nothing** found | **Rethrows** — nothing succeeded, so there is nothing to stand in for |
| P2002 on another column (e.g. `email`) | **Rethrows** — matched on `leadId`, not on "duplicate" |
| Any other error (outage, timeout) | **Rethrows** unchanged |

Two implementation notes:

- The error is **duck-typed** on `{ code, meta.target }` rather than `instanceof Prisma.PrismaClientKnownRequestError`. That class is not reliably exported across generated-client versions, and a failing `instanceof` would silently disable the recovery — the failure mode would be invisible.
- The recovery lookup is scoped to `userId`, so it can only ever return that visitor's own submission.

The transaction now also returns `consultationBookedAt` (coalesced to `null`), and the payload uses it instead of the hardcoded `null` it carried before.

## 4. Files changed

| File | Change |
|---|---|
| `backend/src/scorecard/scorecard.service.ts` | New private `runSubmitScorecardTransaction`; transaction wrapped and its return extended; payload reads `consultationBookedAt` |
| `backend/src/scorecard/scorecard.service.spec.ts` | **Appended** 5 tests (19 → 24). None of PR #4's 19 were altered |
| `docs/HOTFIX_SCORECARD_SUBMIT_RACE_20260821.md` | This file |

## 5. Database / env / services

None, none, none. No migration, no new environment variables, no new third-party dependency.

## 6. How to verify

```bash
cd backend
npx prisma generate
npx tsc --noEmit                                   # 3 errors, all pre-existing (see §7)
npx jest src/scorecard/scorecard.service.spec.ts --runInBand   # 24/24
npx jest --runInBand                               # 126 suites / 1576 tests
```

Manually, after deploy: open the public Scorecard in a private window and double-click *Submit assessment* on the final step. Expect one confirmation and no error banner.

The realistic trigger is worth exercising too, since it is the one that reaches the reused-Lead path: **register for a webinar with an email, then complete the Scorecard anonymously with that same email**, and double-click submit.

If the race is actually hit, the log carries:

```
submitScorecard: recovered from a concurrent-submit race for user <id> —
returning the already-committed submission <id> instead of failing.
```

Absence of that line is not a failure — it means the two clicks did not land inside the window. The thing being verified either way is that no 500 reaches the visitor.

## 7. Known limitations

- **The window is narrowed, not eliminated.** A third concurrent request arriving after the recovery lookup but before its own insert commits could still throw. A browser fires one or two requests per click, so this is not expected in the observed pattern. Closing it fully means a unique constraint or advisory lock on `(userId, isDraft)` at submit time — a larger change than a live incident warrants.
- **This does not change PR #4's Lead-reuse logic**, only wraps error handling around it. If that logic is revisited, re-check this still matches what the transaction returns.
- **`tsc` reports 3 errors** in `scripts/send-real-onboarding.ts`, `scripts/test-portal-report-reachability.ts` and `scripts/test-target-country.ts` — *"Expected 5 arguments, but got 4"*. These are **pre-existing**: PR #4 added a fifth constructor argument to `ScorecardService` and those scripts were not updated. Confirmed 3 both with and without this change by stashing it. They are unrelated to this fix and worth a separate tidy-up.

## 8. Extending this

`runSubmitScorecardTransaction` takes any zero-argument function returning `{id, leadId, submittedAt, consultationBookedAt}` and makes it tolerant of one specific failure. If the same "the request ran twice and collided on a unique constraint" shape appears elsewhere, copy the duck-typed `code`/`meta.target` match — not `instanceof`, for the reason in §3.

## 9. Security

- No new surface. Error handling only, on a path already rate-limited at 5/min/IP.
- Recovery is scoped to `userId` — a race can never return another person's submission.
- The new `logger.warn` emits database IDs only: no answers, no email, no personal data.

## 10. Rollback

Revert the commit. No migration, no data changes, nothing to undo.
