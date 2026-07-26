# Phase 20 — Client Officer Daily Diary ("My day")

End-of-phase handover for a Client Officer's **daily agenda**: a single "My day"
screen listing their nurture **call tasks** and consultation **meetings**, split into
**Today** and **Missed / overdue**. Read-only — it composes existing data and routes
every action to the surface that already owns it.

**Date:** 2026-07-26
**Commit (this phase):**
- `d4af983` — feat(diary): Client Officer daily agenda — today + missed (calls + meetings)

---

## 1. What this phase does

A staff member opens **My day** (`/staff/diary`) and sees, scoped to themselves:

- **Missed / overdue** (shown first — needs attention): nurture call tasks still
  `PENDING` from a prior day, and consultation meetings still `BOOKED`/`CONFIRMED`
  whose scheduled day has passed.
- **Today**: call tasks due today and meetings scheduled today.

It's a **live agenda** (Option 1 of the design discussion) — deliberately **not** a
written journal, and it does **not** durably track/count "missed" for owner oversight
(both were explicitly out of scope; either can be a separate feature later). Buckets
are computed by the **NZ calendar day** (the business timezone). Future items are
omitted (this is "today + overdue", not a full calendar).

**Design decisions worth knowing:**

- **Read-only, zero duplicated action logic.** The diary never marks anything. Each row
  links to the surface that already owns the action: call rows → the **Follow-ups**
  outcome flow (`POST /staff/nurture/tasks/:id/outcome`), meeting rows → **My Meetings**
  `staffMarkStatus` (`PATCH /staff/consultations/:id/status`). This was a hard
  requirement — the diary is a router to existing flows, not a second copy of them.
- **Reuses the "mine" pattern, no new tables.** `assignedToId = caller` for non-admins;
  admin tier (OWNER/SUPER_ADMIN/ADMIN) sees everyone. It's a projection over
  `NurtureCallTask` + `Consultation` — no schema change.
- **NZ-day bucketing avoids the within-day ambiguity.** An item due/scheduled *earlier
  today* stays under **Today** (you still need to do it today); it only becomes
  **Missed** once the NZ day rolls over. Clean split, no double-listing.

## 2. Files created or changed

Pulled from `git show --stat d4af983`.

*Created — backend*
- `backend/src/diary/diary.service.ts` — `getMyDiary(actor, now)`: the mine-scoped
  query + NZ-day bucketing.
- `backend/src/diary/diary.controller.ts` — `GET /staff/diary`.
- `backend/src/diary/diary.module.ts` — module wiring.
- `backend/src/diary/diary.spec.ts` — DB-backed spec (2 tests).

*Created — frontend*
- `frontend/src/app/staff/diary/page.tsx` — gated "My day" page.
- `frontend/src/components/staff/diary/DiaryClient.tsx` — Missed + Today sections,
  read-only rows with action links.

*Changed*
- `backend/src/app.module.ts` — register `DiaryModule`.
- `frontend/src/components/staff/shell/StaffSidebar.tsx` — "My day" nav item.
- `frontend/src/components/staff/overview/StaffOverviewClient.tsx` — a "My day"
  launchpad shortcut for LIA / CONSULTANT / CLIENT_CONSULTANT.

## 3. Database tables / columns added

**None.** Pure read-composition over existing `nurture_call_tasks` +
`consultations`.

## 4. Environment variables added (names only)

**None.**

## 5. Third-party services connected

**None.**

## 6. How to test it works

**Automated** — `diary.spec.ts` (DB-backed, 2/2 green): the four-item scenario — a
call due today, an overdue call, a meeting today, and a past-due un-actioned meeting —
lands in the right buckets; a COMPLETED past meeting, a future call, and another
officer's call are all excluded; the admin tier sees every officer's items while a
non-owning officer sees none.

**Manual:**
1. As a Client Officer with nurture call tasks + booked consultations, open **My day**
   (`/staff/diary`, or the "My day" card on the `/staff` overview).
2. Confirm today's calls/meetings appear under **Today**, and anything from prior days
   still open appears under **Missed / overdue** (shown first, with a count badge).
3. Click **Log outcome** on a call → lands on **Follow-ups**; click **Open / Mark
   outcome** on a meeting → lands on **My Meetings**. Action them there; back on My day
   they drop off (call marked DONE/SKIPPED, meeting marked COMPLETED/NO_SHOW).
4. As an admin, confirm the page shows all officers' items; as a different officer,
   confirm you only see your own.

## 7. Known limitations

- **Missed is surfaced live, not tracked.** There's no persistent "missed" flag/count
  and no owner-facing accountability view — by design (out of scope). An item leaves
  the Missed list the moment it's actioned; nothing records that it *was* missed.
- **No journal / notes.** "My day" is an agenda only; there is no place to write a daily
  diary entry (explicitly deferred).
- **Scope is calls + meetings only.** Cases/leads needing action are not part of this
  view (deferred).
- **"Today" is the NZ calendar day for everyone.** A staff member in another timezone
  still sees the NZ day. Fine for an NZ-based team; would need per-user TZ if that
  changes.
- **Actions are links, not inline.** You leave My day to action an item (Follow-ups /
  My Meetings) — a deliberate anti-duplication choice, at the cost of one extra click.
- **No pagination.** All of a caller's open calls/meetings render; fine at current
  volume, revisit if a single officer accumulates hundreds of overdue items.

## 8. How a future developer would extend this

- **Add a source to the agenda** (e.g. cases needing action): add another query in
  `DiaryService.getMyDiary` with the same `mine` filter + NZ-day bucketing, and a row
  renderer in `DiaryClient`. Keep it read-only + link to that source's own action
  surface.
- **Durable missed-tracking / owner oversight** (if ever needed): that's a separate
  feature — e.g. a nightly sweep that stamps a `missedAt` on overdue call tasks and an
  owner dashboard counting them. Do NOT bolt counting onto this live view.
- **Inline actions:** if a future call wants in-place outcome logging, reuse the
  existing endpoints (`/staff/nurture/tasks/:id/outcome`, `/staff/consultations/:id/status`)
  — never re-implement the outcome/mark logic.
- **Per-user timezone:** `DiaryService.nzDate()` is the single place that defines "the
  day"; swap `Pacific/Auckland` for the actor's TZ there.

## 9. Security layers applied

- **Role-gated + self-scoped.** `GET /staff/diary` is `@Roles(OWNER, SUPER_ADMIN,
  ADMIN, LIA, CONSULTANT, CLIENT_CONSULTANT)` behind JWT + RolesGuard; the service
  scopes to `assignedToId = caller` for non-admins, so an officer only ever sees their
  own calls/meetings. The frontend page also server-checks the session.
- **Read-only.** No mutation path exists here — every action happens on the existing,
  already-authorized surfaces, so the diary can't be used to action someone else's item.
- **No new data exposure.** It returns the same client-safe fields those surfaces
  already show (name, step/type, due/scheduled time, status) — no notes, no internals.

## 10. Rollback instructions

Pure read-only frontend + a read endpoint, no migration — a straight git revert.

1. **Full revert:** `git revert d4af983`. Removes the diary module/endpoint, the page,
   the nav item, and the overview shortcut. Nothing else depends on them; the
   underlying call tasks + consultations are untouched.
2. **Partial (hide the surface, keep the API):** remove the "My day" entries from
   `StaffSidebar.tsx` + `StaffOverviewClient.tsx` and delete `app/staff/diary/` — the
   `GET /staff/diary` endpoint stays available for any future re-enable.
3. **No data / env / service cleanup** — there is none.
