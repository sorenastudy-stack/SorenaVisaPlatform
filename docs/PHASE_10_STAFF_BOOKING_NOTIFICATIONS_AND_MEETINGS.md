# Phase 10 — Staff Booking Notifications & Meetings Calendar

End-of-phase handover for three related staff-side booking improvements plus the
Node version pin that unblocked the Railway frontend build. Built, tested, and
deployed to production.

**Date:** 2026-07-23
**Commits (this phase):**
- `4c325e0` — fix(booking): notify the assigned staff member when a client books
- `8c9aa18` — fix(staff-bookings): let Client Officers see their own meetings
- `b2469fb` — feat(staff-meetings): calendar view, Join links, and Add-to-calendar (.ics)
- `5cf9263` — fix(frontend): regenerate lockfile so npm ci works on Railway (npm 9/10)
- `227149e` — fix(frontend): restore cross-platform native deps in lockfile for Railway build
- `f22e0fc` — chore(frontend): pin Node 20 (.nvmrc + engines) to prevent lockfile drift

---

## 1. What this phase does

Three independent fixes to the staff booking experience, plus a build-stability pin:

1. **Staff email on booking.** When a client books a consultation, the platform
   already emailed the *client* a confirmation but never told the *assigned staff
   member*. We added `sendStaffBookingNotification` so the booked adviser now gets
   an email (from the same Resend sender, with the same session/timezone/Join-link
   details) the moment a booking confirms — best-effort and session-guarded, so a
   webhook retry never double-notifies.
2. **Client Officer booking-visibility fix.** The `CLIENT_CONSULTANT` role (display
   name "Client Officer") was missing from the `/staff/bookings` allow-list, so
   Client Officers got a 403 that the "My Meetings" UI rendered as a permanent
   empty state ("No meetings yet") — even though clients had booked sessions with
   them. Added `CLIENT_CONSULTANT` to the controller's `STAFF` set.
3. **Meetings calendar upgrade.** The staff `/staff/meetings` page went from a flat
   list to a proper **react-big-calendar** view (Day / Work-Week / Month) with a
   secondary list tab, per-meeting **Join** links (the stored Jitsi link), and an
   **Add to calendar** (`.ics`) download. The `/staff/bookings` read endpoint now
   also returns `meetingLink`, `scheduledEndAt`, and `durationMinutes` to power it.
4. **Node 20 pin.** A series of `npm ci` failures on Railway (Windows npm 11 dev
   machine vs Railway's npm 10 dropping cross-platform native deps from the
   lockfile) were fixed by regenerating the lockfile and then **pinning Node 20**
   via `.nvmrc` + `engines.node` so the dev and CI toolchains can't drift again.

## 2. Files created or changed

Pulled from `git diff --stat 8e54a49..f22e0fc`. **12 files, +817 / −47.**

**Created**
- `backend/src/booking/booking-confirmation.service.spec.ts` — regression test that a
  confirmed booking notifies **both** the client and the assigned staff member, and
  that a duplicate/retry does not re-notify. `4c325e0`.
- `backend/src/staff/bookings/staff-bookings.gate.spec.ts` — pins the `/staff/bookings`
  role gate: must admit `CLIENT_CONSULTANT` (and the other staff roles), reject
  clients/leads. `8c9aa18`.
- `frontend/src/lib/ics.ts` — dependency-free `.ics` (iCalendar) builder +
  `downloadIcs` browser helper (`IcsMeeting`, `buildIcs`, `downloadIcs`). `b2469fb`.
- `frontend/.nvmrc` — `20`. `f22e0fc`.

**Changed**
- `backend/src/mail/mail.service.ts` — added `sendStaffBookingNotification(...)`
  (best-effort; `this.send` swallows failures so email issues never block a booking).
  `4c325e0`.
- `backend/src/mail/mail.templates.ts` — added `staffBookingNotificationBody(...)`
  (staff-facing booking email HTML). `4c325e0`.
- `backend/src/booking/booking-confirmation.service.ts` — after emailing the client,
  also resolves the assigned `User`'s email and calls `sendStaffBookingNotification`,
  under the **same session-completion guard** used for the client email. `4c325e0`.
- `backend/src/staff/bookings/staff-bookings.controller.ts` — added `CLIENT_CONSULTANT`
  to the `STAFF` allow-list. `8c9aa18`.
- `backend/src/staff/bookings/staff-bookings.service.ts` — the `/staff/bookings` list
  query now additionally selects + maps `meetingLink`, `scheduledEndAt`,
  `durationMinutes` (additive passthrough). `b2469fb`.
- `frontend/src/components/staff/meetings/StaffMeetingsClient.tsx` — rebuilt as a
  react-big-calendar view with a list tab, Join links, and Add-to-calendar. `b2469fb`.
- `frontend/package.json` — added `react-big-calendar` (+ `date-fns`) and the
  `engines: { node: "20.x" }` pin. `b2469fb` / `f22e0fc`.
- `frontend/package-lock.json` — regenerated to restore cross-platform native deps
  (e.g. `@parcel/watcher-linux-x64-glibc`, `@swc/helpers`) that a mismatched npm
  had pruned. `5cf9263`, `227149e`, `f22e0fc`.

The staff-notify call, guarded so retries don't re-notify:

```ts
// 3. Notify the assigned staff member (the booked User) — same session guard,
//    so webhook retries don't re-notify.
const staffEmail = c.assignedTo?.email ?? null;
if (staffEmail) {
  const staffGreeting = c.assignedTo?.name || 'there';
  await this.mail.sendStaffBookingNotification(
    staffEmail, staffGreeting, clientName, sessionLabel, whenStr, meetingLink,
  );
}
```

## 3. Database tables / columns added

**None.** This phase is code-only. The `/staff/bookings` change reads columns that
already exist on `Consultation` (`meetingLink`, `scheduledEndAt`, `durationMinutes`);
no migration was created or run.

## 4. Environment variables added (names only)

**None.** The staff booking email reuses the existing Resend SMTP configuration
(`RESEND_*` / mail env already in place). The Node pin is config-file only
(`.nvmrc` + `engines`), not an env var.

## 5. Third-party services connected

- **Resend (email)** — no new account/keys; the staff notification is sent through
  the platform's existing Resend sender, identical to the client booking email.
- **Jitsi (video)** — no new integration; the **Join** link is the meeting link that
  is already generated and stored on the booking at confirm time. The calendar and
  `.ics` simply surface it.
- **Railway (build/runtime)** — the Node 20 pin (`.nvmrc` + `engines.node`) targets
  Railway's Nixpacks Node detection so CI matches local.

## 6. How to test it works

**A. Staff email on booking**
1. As a client, book a consultation with a staff member who has a real email
   (use a throwaway staff test account you can read).
2. Complete the booking so it **confirms** (free booking, or a paid one through to
   payment success).
3. Confirm **two** emails arrive: the client confirmation **and** a "New booking:
   {client} — {session}" email to the assigned staff member, both with the session
   time, timezone, and Join link.
4. Re-trigger the confirmation webhook (or refresh) and confirm **no** duplicate
   staff email is sent (session guard).

**B. Client Officer sees their meetings**
1. Log in as a user with role **CLIENT_CONSULTANT** (Client Officer) who has at
   least one booked session.
2. Open **My Meetings** (`/staff/meetings`). Confirm the sessions render — not the
   "No meetings yet" empty state. (Before the fix this 403'd.)

**C. Meetings calendar**
1. On `/staff/meetings`, switch between **Day / Work-Week / Month** and the **list**
   tab; confirm bookings appear in the right slots, colour-coded by status.
2. On an upcoming meeting, click **Join** → opens the Jitsi link. Click
   **Add to calendar** → downloads an `.ics` that imports into Google/Apple/Outlook
   with the correct title, time, and Join URL.

**Automated checks already green:** `booking-confirmation.service.spec`
(client + staff notified, retry does not re-notify), `staff-bookings.gate.spec`
(gate admits `CLIENT_CONSULTANT`, rejects non-staff).

## 7. Known limitations

- **Staff email is best-effort.** `sendStaffBookingNotification` is wrapped so a mail
  failure never blocks or fails the booking — a transient Resend outage means the
  staff member silently doesn't get that one email (the booking still exists and
  shows in My Meetings). No retry queue.
- **Calendar is read-only.** Staff can view/join/export but cannot create, drag, or
  reschedule bookings from the calendar; status changes still go through the existing
  mark-status actions.
- **`.ics` has no live updates.** The download is a point-in-time snapshot; if a
  booking is later rescheduled, the staff member must re-download (there is no
  calendar-subscription feed).
- **Node pin is `20.x`, not an exact patch.** It prevents major-version drift but not
  every patch difference; the lockfile is the real guarantee.

## 8. How a future developer would extend this

- **Change the staff email copy:** edit `staffBookingNotificationBody` in
  `backend/src/mail/mail.templates.ts`; the send lives in
  `MailService.sendStaffBookingNotification` (`mail.service.ts`).
- **Notify additional parties (e.g. an admin):** add another guarded `this.mail.*`
  call in `BookingConfirmationService` alongside the existing client + staff sends —
  keep it inside the same session-completion guard so retries stay idempotent.
- **Add a field to the calendar/`.ics`:** the booking payload comes from the
  `/staff/bookings` select+map in `staff-bookings.service.ts` (add the column there),
  then consume it in `StaffMeetingsClient.tsx` / `buildIcs` in `frontend/src/lib/ics.ts`.
- **Adjust who can see `/staff/bookings`:** the `STAFF` allow-list constant at the top
  of `staff-bookings.controller.ts` (the per-action "assigned or admin" rule is
  separately enforced in `BookingCancellationService`).

## 9. Security layers applied

- **The booking read/gate is role-scoped and fail-closed.** `/staff/bookings` is
  guarded by `StaffRolesGuard` + the `STAFF` allow-list; a non-staff caller is
  rejected. Non-admin staff only ever see bookings **assigned to them**
  (`assignedToId = JWT user`) — the client never supplies a user id.
- **The `CLIENT_CONSULTANT` fix widens visibility by exactly one legitimate role**,
  and the regression spec pins the gate so the role set can't silently regress.
- **Staff email exposes no secrets** — it contains the client name, session label,
  time, and the Join link the staff member is already entitled to; it is sent to the
  assigned staff member's own address only.
- **No new secrets or endpoints** were introduced; the Node pin is build-config only.

## 10. Rollback instructions

This phase is **code-only (no migrations, no env vars)**, so rollback is a git revert:

- **Staff email:** `git revert 4c325e0`. Bookings continue to work; only the staff
  notification stops. (Or feature-flag the single call in `BookingConfirmationService`.)
- **Client Officer gate fix:** `git revert 8c9aa18` — **not recommended**; this
  re-locks Client Officers out of their own meetings (the bug it fixed).
- **Calendar UI:** `git revert b2469fb` restores the flat list; the extra
  `/staff/bookings` fields are additive and harmless if left.
- **Node pin:** revert `f22e0fc` (and, if needed, `227149e` / `5cf9263`) to unpin
  Node — **not recommended**, as it reopens the lockfile/`npm ci` build failures on
  Railway. Prefer keeping the pin.

No database rollback is required for any part of this phase.
