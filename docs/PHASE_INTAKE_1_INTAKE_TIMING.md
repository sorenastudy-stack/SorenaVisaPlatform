# PR-INTAKE-1 — intake-timing rules (5-month offer window + 4-month LIA deadline)

Two related, per-country intake-timing rules, built on one shared frozen utility.
Consequential — the 4-month rule **automatically reassigns a real client's term** —
so the decision logic + client-facing copy are freeze-tested before any live wiring.

**Date:** 2026-08-01
**Status:** built + verified (freeze batteries + integration smoke, all paths).

---

## The two rules

- **5-month rule (offer-time filter, Slice 2):** the earliest intake OFFERED to a
  student is at least `intakeMinLeadMonths` (5) out, up to `intakeMaxWindowMonths`
  (12); an intake in a later calendar year shows a **conditional-offer warning**.
- **4-month rule (post-submit, Slice 3):** a completed Apply/Study form must be
  **Submitted at least `liaLeadMonths` (4) before the priority-1 intake's start**
  (LIA needs the file that early). Checked **point-in-time at Submit**. Miss it by
  even one day → the system auto-reassigns to the next valid term (or flags manual
  review), notifies the student, and creates an Admission-Officer task.

## Config (Owner-editable, per-country)

`CountryExecutionConfig` gained `intakeMinLeadMonths(5)`, `intakeMaxWindowMonths(12)`,
`liaLeadMonths(4)` — genuinely country-specific (they encode the destination's visa
SLA + LIA lead time). Editable via the Owner Country-Config screen + API; seeded for
NZ. Additive migration.

## Slice 1 — foundation utility (`matching/intake-window.ts`, frozen)

Pure, deterministic (clock always injected). **Month granularity**: intake start is
pinned to the 1st of the month (the free-text `ProgrammeIntake.label` is ignored;
the source of truth is `EducationProgramme.intakeMonths`). Day-aware comparisons so
the exact boundaries behave. Functions: `inOfferWindow` (inclusive both ends),
`isConditionalOffer`, `eligibleIntakes`, `nextEligibleIntake` (**→ `null` when none
qualifies**), `meetsLiaDeadline` (exact 4-month boundary — on-the-mark passes, +1
day fails), and `decideReassignment → NONE | REASSIGN | MANUAL_REVIEW`. 16 golden
cases (both rules, both directions, the null edge case, the 1-day-past flip).

## Slice 2 — 5-month rule at offer time

`GET /public/programmes` now returns server-computed `eligibleIntakes`
(`[{month, year, conditional}]`) per programme — window-filtered + conditional-
flagged from the utility + config. **Step 1's intake dropdown** uses this (can no
longer surface a sub-5-month intake), shows a **conditional-offer warning banner**
when the selected term is a later calendar year, and a note when a programme has no
offerable intake in the window. (Inline English copy — keeps Persian frozen.)

## Slice 3 — 4-month deadline + auto-reassignment

Hooks into `submitApplication`, **post-commit** (never blocks a valid submission),
on the **priority-1 choice only**. Runs `decideReassignment`:

| Decision | Effect |
|---|---|
| **NONE** (in time) | nothing |
| **REASSIGN** (late, next term found) | update the priority-1 `AdmissionProgrammeChoice` intake → next; create `AdmissionTask{INTAKE_REASSIGNED}` (assigned to `Case.consultantId`, or the unassigned queue if null); log `INTAKE_AUTO_REASSIGNED` case history; **notify student** ("moved to next term: X") |
| **MANUAL_REVIEW** (late, **no valid next term** — fail safe, never a guess) | leave the intake **unchanged**; set `AdmissionApplication.intakeReviewNeeded = true`; create **urgent** `AdmissionTask{INTAKE_REASSIGN_FAILED}`; log `INTAKE_REASSIGN_MANUAL_REVIEW`; notify student with a **calm "under review"** message (no false promise) |

If the reassignment logic itself errors → falls to the manual-review branch
(flag + urgent task). **Never silent.**

New surfaces:
- **`AdmissionTask`** model (+ `AdmissionTaskType`/`Status` enums) — a focused
  Officer to-do list; **not** an overload of `NurtureCallTask`.
- **`GET /staff/admission-tasks`** (mine + unassigned; `?scope=all` for admin) +
  **`PATCH :id/resolve`** (CONSULTANT-tier).
- **`AdmissionApplication.intakeReviewNeeded`** — the visible "needs manual
  intervention" flag.
- Student notifications reuse the shared `notifyAdmissionTicket` util (the
  persistent ADMISSIONS `VisaSupportTicket` thread from PR-ADMISSION-SHARED; the
  staff service was refactored to share it too).

## Where the reassigned term shows to the student

`Apply/Study Step 1` (the only place programme+intake is displayed) reads choices
from the backend, so the updated term reflects on next load — no live push needed.

## Verification

- **Freeze batteries:** intake-window (16), reassignment copy (4) — exact values,
  including the null edge case, the 1-day-past deadline, and both client messages.
- **Integration smoke (all 3 submit-time paths):** NONE (no change/task/ticket/flag);
  REASSIGN (choice moved to the next valid term + non-urgent task to the officer +
  ticket + history); MANUAL_REVIEW (intake unchanged + `intakeReviewNeeded` true +
  **urgent** task + softer ticket + history). Plus an isolation check decrypting the
  MANUAL_REVIEW message = the exact softer copy, SYSTEM-authored, unassigned-queue
  when `consultantId` is null.
- Backend gate **119/119**; **frontend production build compiled**; both builds clean.

## Flags / next

- **Month-granularity dates** (start = 1st of month) are deliberate; a day-precision
  structured-intake migration is a separate, bigger decision if ever needed.
- **No Officer task-list UI yet** — the `GET /staff/admission-tasks` endpoint is
  ready; surfacing it (a page, or folding into the Diary "My day") is the natural
  next build.
- **PR-RECS-2 (`PrioritySlot`)** remains parked/separate — untouched.
