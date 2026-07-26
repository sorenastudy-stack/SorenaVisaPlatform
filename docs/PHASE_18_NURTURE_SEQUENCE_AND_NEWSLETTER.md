# Phase 18 — Nurture Sequence & Monthly Newsletter

End-of-phase handover for the post-FREE_15 **nurture sequence** — a blended
automated-email + human-phone-call re-engagement program for leads who finished
their free 15-minute consultation but didn't commit to signing — followed by an
**indefinite monthly newsletter**. Built by reusing the visa-expiry cron +
dedup-ledger pattern; the only genuinely new surface is the phone-call-task side
(there was no task model in the codebase).

**Date:** 2026-07-25
**Commit (this phase):**
- `e5dd1b0` — feat(nurture): post-FREE_15 nurture sequence (4 emails + 3 call tasks / 21 days) → monthly newsletter

---

## 1. What this phase does

A Client Officer marks a not-ready lead via **"Mark not ready"** on the lead detail
page. That enrols the lead into a **7-touch, 21-day sequence**, then an **ongoing
monthly newsletter**:

| Day | Touch | Channel |
|-----|-------|---------|
| 1  | Recap the consultation, restate the pathway | Email |
| 3  | Call task #1 | Phone (Client Officer) |
| 6  | Address the #1 objection (cost / timeline / documents) | Email |
| 9  | Call task #2 | Phone |
| 13 | A similar-student story | Email |
| 17 | Honest urgency (real intake deadlines) | Email |
| 21 | Call task #3 (final attempt) | Phone |
| 21+ | Monthly newsletter (blog / video / webinar), indefinitely | Email |

A **daily cron** drives the schedule. **Exit conditions** stop everything the moment
a lead re-engages: a contract now exists, a new consultation is booked after
enrolment, or the lead is marked QUALIFIED/DISQUALIFIED. A Client Officer can also
**manually stop** a sequence (e.g. the lead replied directly). Every marketing email
carries a working **unsubscribe** link.

**Design decisions worth knowing (a future dev will hit these):**

- **The phone-call side needed a new model.** There is no generic task/reminder model
  in the codebase, and a nurture-stage lead has **no `Case`** (a Case is created only
  at `QUALIFIED`; nurture is the *not*-qualified branch), so the existing case-notes
  surface couldn't hold a call outcome. `NurtureCallTask` is lead-attached and carries
  its own outcome capture.
- **Idempotency is structural, not procedural.** Emails dedupe on
  `LeadNurtureSent(leadId, step)` and calls on `NurtureCallTask(leadId, step)` — the
  unique indexes ARE the guarantee, so re-running the daily cron never double-sends or
  double-creates. This is the visa-expiry ledger pattern, reused deliberately.
- **Unsubscribe stops MARKETING EMAILS ONLY.** A phone call is not email marketing, so
  unsubscribing does NOT cancel pending Client Officer call tasks and does NOT end the
  enrolment — the remaining scheduled calls still get created, and the CO stays free to
  call. Email + newsletter sends are muted per-send in the sweep (checked before every
  send, not just at enrolment). Contrast with **manual stop** and **exit conditions**,
  which DO end everything and close open call tasks.
- **The whole engine is one injected-clock function.** `runDailySweep(now)` and every
  helper derive timing from `nurtureStartedAt` + `now`, so the 21-day schedule and the
  28-day newsletter cadence are testable deterministically (6 scenarios over 21+
  simulated days run in ~4s).

## 2. Files created or changed

Pulled from `git show --stat e5dd1b0`.

*Created — backend*
- `backend/prisma/migrations/20260725170000_pr_nurture_sequence/migration.sql` — the
  additive migration (hand-authored; see §3 for why).
- `backend/src/nurture/nurture.service.ts` — the engine (enrol, sweep, exits, calls,
  newsletter, unsubscribe, staff task list + outcome logging).
- `backend/src/nurture/nurture-cron.service.ts` — `@Cron('15 9 * * *')` NZ wrapper.
- `backend/src/nurture/nurture.controller.ts` — staff endpoints (`/staff/nurture/*`).
- `backend/src/nurture/nurture-public.controller.ts` — public unsubscribe.
- `backend/src/nurture/dto/nurture.dto.ts` — request DTOs.
- `backend/src/nurture/nurture.module.ts` — module wiring.
- `backend/src/nurture/nurture.spec.ts` — DB-backed spec (6 scenarios).

*Created — frontend*
- `frontend/src/app/unsubscribe/page.tsx` — public unsubscribe confirm page.
- `frontend/src/app/staff/follow-ups/page.tsx` — gated "Follow-ups" page.
- `frontend/src/components/staff/nurture/FollowUpsClient.tsx` — the call-task list +
  log-outcome + stop.
- `frontend/src/components/staff/nurture/NurtureControl.tsx` — "Mark not ready" /
  stop control on the lead detail page.

*Changed*
- `backend/prisma/schema.prisma` — Lead nurture fields + `NurtureCallTask` +
  `LeadNurtureSent` + `NurtureStage` / `NurtureCallStatus` enums + User inverse
  relations.
- `backend/src/mail/mail.templates.ts` — 4 nurture + 1 newsletter body builders, a
  CTA button, a video-thumbnail slot, a "no need to reply" note, and an
  `unsubscribeUrl` slot in the shared `wrapHtml` footer.
- `backend/src/mail/mail.service.ts` — `sendNurtureSequenceEmail` /
  `sendNurtureNewsletter` (returning-send + nurture sender) and the `.com` default.
- `backend/src/email/email.service.ts` — legacy sender default `.co.nz` → `.com`.
- `backend/src/app.module.ts` — register `NurtureModule`.
- `backend/.env.example` — `.com` default + documented `NURTURE_EMAIL_FROM`.
- `frontend/src/app/staff/leads/[id]/page.tsx` — render `<NurtureControl />`.
- `frontend/src/components/staff/shell/StaffSidebar.tsx` — "Follow-ups" nav item.

## 3. Database tables / columns added

**New tables:** `nurture_call_tasks`, `lead_nurture_sent`.
**New enums:** `NurtureStage` (NONE/SEQUENCE/NEWSLETTER/ENDED), `NurtureCallStatus`
(PENDING/DONE/SKIPPED/AUTO_CLOSED).
**New `leads` columns:** `nurtureStage`, `nurtureStartedAt`, `nurtureReason`,
`nurtureUnsubscribedAt`, `nurtureUnsubToken` (unique), `nurtureLastNewsletterAt`.

All additive — nullable columns + new tables, no data backfill, no destructive change.

**Migration authoring note (important for the next migration):** `prisma migrate dev`
fails on this repo's shadow-DB replay (a historical migration,
`20260611120000_option_c_passwordless_auth_prep`, can't replay cleanly on a fresh
shadow), and `migrate diff --from-schema-datasource` reads the *stale local dev DB* and
emits huge spurious FK-churn. The reliable path used here: spin up a fresh throwaway
DB, `prisma migrate deploy` (which replays the full history cleanly — proven), then
`migrate diff --from-url <fresh-db> --to-schema-datamodel` and hand-trim to the
feature's own objects. The committed migration was verified by a full `migrate deploy`
replay on a clean DB.

## 4. Environment variables added (names only)

- **`NURTURE_EMAIL_FROM`** — sender for nurture + newsletter emails. Falls back to
  `EMAIL_FROM` when unset. Both now default to `Sorena Visa <noreply@sorenavisa.com>`
  (the Resend-verified domain; `sorenavisa.co.nz` is not owned and every reference was
  removed).

No new secrets. Uses the existing `RESEND_API_KEY` + `FRONTEND_URL`.

## 5. Third-party services connected

**None new.** Emails go through the existing Resend integration (`MailService`). The
`sorenavisa.com` sending domain is already verified in Resend (Tokyo region) — no
additional verification step is needed; the env var simply points at it.

## 6. How to test it works

**Automated** — `nurture.spec.ts` (DB-backed, 6/6 green): the 21-day schedule fires by
day with no duplicate sends across cron re-runs; all 4 exit conditions end everything
and AUTO_CLOSE open tasks; manual stop; Day-21 → monthly-newsletter transition +
~28-day cadence + empty-month suppression; **email-only unsubscribe** (emails stop,
call tasks keep running, newsletter muted); and per-Client-Officer call-task assignment
+ ownership-gated outcome logging.

**Manual (end-to-end):**
1. **Enrol:** `/staff/leads/<id>` → **Nurture** card → **"Mark not ready — start
   nurture."** (Lead needs a COMPLETED FREE_15 whose `assignedToId` is a Client
   Officer.) Stage → SEQUENCE, status → NURTURE.
2. **Drive the schedule:** admin `POST /staff/nurture/run-sweep-now` (or wait for the
   daily cron). Day-1 email sends. To simulate later days in a test DB, set the lead's
   `nurtureStartedAt` back N days and re-run the sweep — due emails send, call tasks
   appear.
3. **Call tasks:** sign in as that Client Officer → **Follow-ups** → Day-3/9/21 calls,
   oldest-first → **Log outcome** (Done/Skip + notes). A different CO can't see them;
   admins see all.
4. **Exit:** send/request a contract, book a new consultation, or set the lead
   QUALIFIED/DISQUALIFIED → next sweep ends the sequence + closes open tasks; no more
   emails.
5. **Newsletter:** get a lead past Day 21 → stage NEWSLETTER. With no content
   configured, nothing sends (graceful). Once `getNewsletterContent` returns a
   blog/video/webinar, one newsletter/month goes out (a second only ~28 days later).
6. **Unsubscribe:** open a nurture email → footer **Unsubscribe** → `/unsubscribe?token=…`
   → confirm. That lead never gets another nurture/newsletter **email** — but its
   **pending call tasks remain**, and remaining scheduled calls still appear for the CO.

## 7. Known limitations

- **Newsletter content is not yet wired to a source.** `NurtureService.getNewsletterContent()`
  returns empty by default (so no newsletter sends until content exists — the graceful
  path). Hooking it to a real blog feed / YouTube / webinar schedule is a follow-up; the
  template slots and empty-month suppression are already built.
- **Nurture email copy is placeholder.** The 4 templates have final *structure* (one CTA,
  the optional YouTube-thumbnail slot, the "no need to reply" note, the unsubscribe
  footer) but the marketing prose and real video/blog links are TBD.
- **"Lead replies" is a manual exit, not automatic.** There is no inbound-email parsing,
  so a direct reply doesn't auto-stop the sequence — the Client Officer uses **Stop
  nurture**. (The other four exit conditions ARE automatic.)
- **An unsubscribed lead is still swept daily.** Because unsubscribe intentionally keeps
  the call schedule alive, an unsubscribed lead stays in SEQUENCE/NEWSLETTER and the
  daily sweep keeps visiting it (doing an exit-check + muted no-op sends). Harmless at
  current lead volume; if it ever matters, end the enrolment once the last call task is
  created.
- **`getNewsletterContent` is global, not per-month-audience-segmented.** Every
  NEWSLETTER-stage lead gets the same monthly content; there's no per-lead
  personalisation beyond the name.
- **No live delivery test was run from `noreply@sorenavisa.com`** in this environment
  (that needs a real recipient). The sender resolution + verified domain are in place;
  the first real send should be spot-checked.

## 8. How a future developer would extend this

- **Change the schedule / cadence:** the 7 touches are the `SEQUENCE` array in
  `nurture.service.ts` (step + day + channel); `SEQUENCE_LENGTH_DAYS` (21) and
  `NEWSLETTER_INTERVAL_DAYS` (28) are constants right below it. Add/rename touches there
  — the ledger `step` keys and the call-task `step` follow automatically.
- **Wire real newsletter content:** implement `NurtureService.getNewsletterContent(now)`
  (the single seam) to return `{ blog, video, webinars }` from wherever the content
  lives. Empty slots already render nothing; all-empty already suppresses the send.
- **Add email copy / videos:** edit the body builders in `mail.templates.ts`
  (`nurtureRecapBody` / `nurtureObjectionBody` / `nurtureStoryBody` /
  `nurtureUrgencyBody` / `newsletterBody`). Pass a `video` slot (`{ youtubeUrl,
  thumbnailUrl, caption }`) to render the YouTube thumbnail.
- **Add a WhatsApp touch later:** the WhatsApp send capability exists
  (`WhatsappService.sendMessage`) but requires Meta template approval for proactive
  outbound — a call-task-style "channel" could be added to `SEQUENCE`.
- **Surface the sweep to ops:** `POST /staff/nurture/run-sweep-now` already runs it on
  demand (admin tier); add a dashboard read from `LeadNurtureSent` if a delivery view is
  wanted (mirrors visa-expiry's).

## 9. Security layers applied

- **Staff endpoints gated:** `/staff/nurture/*` is `@Roles('OWNER','SUPER_ADMIN','ADMIN',
  'CONSULTANT','CLIENT_CONSULTANT')` behind JWT + RolesGuard; `run-sweep-now` re-gates to
  admin tier. The frontend pages also server-check the session.
- **Call-task ownership enforced:** `completeCallTask` refuses anyone but the assigned
  Client Officer or an admin, and refuses a task that isn't PENDING.
- **Public unsubscribe is token-authorized, not open:** the per-lead
  `nurtureUnsubToken` (a 24-byte random) IS the authorization; it's a POST (not a GET),
  so email-scanner link prefetching can't silently unsubscribe someone, and the route is
  rate-limited (10/min/IP).
- **Unsubscribe is honoured before every send,** not just recorded — the sweep checks
  `nurtureUnsubscribedAt` per email/newsletter, so an opt-out can never be bypassed by a
  stale enrolment.
- **Email content is escaped** (the shared `esc()` in the templates) even for non-PII
  substitutions like names, so a stray character can't break the shell.
- **Mail failures never block:** sends are best-effort and recorded as SENT/FAILED in the
  ledger; a Resend outage records FAILED and the unique index prevents a retry storm.

## 10. Rollback instructions

The migration is additive (new nullable columns + two new tables), so rollback is a git
revert; the columns/tables can be left in place harmlessly.

1. **Disable without reverting (fastest):** the feature only *acts* via the daily cron
   and the staff "Mark not ready" control. To stop all activity immediately, no lead can
   be enrolled if the control is hidden; existing enrolments stop the moment you comment
   out the `@Cron` in `nurture-cron.service.ts` (the sweep no longer runs). Nothing else
   references the nurture tables.
2. **Full revert:** `git revert e5dd1b0`. This removes the module, controllers,
   templates, cron, and frontend surfaces. The two new tables + Lead columns remain in
   the DB (additive) — drop them separately only if desired; leaving them is safe and
   nothing else reads them.
3. **Sender env:** `EMAIL_FROM` / `NURTURE_EMAIL_FROM` now point at
   `noreply@sorenavisa.com`. These are correct regardless of this feature (the old
   `.co.nz` domain isn't owned), so do NOT roll them back.
4. **No data cleanup needed** — nothing outside the nurture tables was written; enrolment
   set `leadStatus = NURTURE` on affected leads, which is a valid pre-existing status.
