# PR-LIA-9 — Automated visa expiry reminders

PR-LIA-8 captured the moment INZ decides; PR-LIA-9 closes the long tail. Approved visas have an `visaEndDate`, and 30 / 14 / 7 days out from that date the system sends a reminder triplet to the LIA, the client, and every OWNER. A daily 09:00 NZ cron sweeps the `visas` table, dedup'd per (visa, threshold, recipient) so re-runs are safe.

The PR-LIA-8 schema already laid the groundwork: `@@index([visaEndDate])` on `Visa` is the indexed access path this PR's daily query relies on. This PR adds one new table (the dispatched-reminder ledger), one cron-decorated service, one dashboard endpoint, one manual-trigger endpoint, three NotificationsService methods, and a small front-end surface that pulls it all together.

---

## 1. Scope

In:

* One new Prisma model — `VisaExpiryReminderSent` (the dispatched-reminder ledger)
* One new enum — `VisaExpiryReminderRecipient` (`LIA` | `CLIENT` | `OWNER`)
* `@nestjs/schedule` registered and used via `@Cron('0 9 * * *', { timeZone: 'Pacific/Auckland' })`
* New backend service `VisaExpiryService` — daily sweep + idempotent dispatcher + dashboard query
* Two new endpoints under `/staff/visa-expiry/*`
* Three best-effort `NotificationsService` methods
* Five new audit event types
* LIA dashboard "Expiring soon" stat card (6th card)
* Dedicated `/lia/expiring-soon` page with threshold-chip filter
* `<RunReminderSweepButton>` (OWNER/ADMIN/SUPER_ADMIN only) for manual sweep
* Sidebar nav "Expiring Soon" entry (Clock icon)
* Case-detail banner when an approved visa is ≤30 days from expiry

Out (deferred):

* SMS reminders (PR-LIA-9.1)
* Configurable thresholds (PR-LIA-9.2)
* Renewal-application workflow (PR-LIA-9.3)
* Persian/Farsi email templates (PR-LIA-9.4)
* WhatsApp reminders
* Reminder analytics ("did this lead to a renewal?")
* Snooze / opt-out flag on the client User
* Per-LIA reminder cadence preferences
* Public-holiday calendar awareness (the cron runs every day regardless)

---

## 2. Data model

```
                   ┌──── Visa (PR-LIA-8) ────┐
                   │ outcome=APPROVED        │
                   │ visaEndDate (indexed)   │
                   └──────────────┬──────────┘
                                  │ 1:N
                                  ▼
   ┌────── VisaExpiryReminderSent (PR-LIA-9) ──────┐
   │ visaId                                         │
   │ thresholdDays    (30 | 14 | 7)                │
   │ recipient        (LIA | CLIENT | OWNER)        │
   │ recipientUserId  (null for OWNER fan-out)      │
   │ sentAt                                         │
   │ emailDeliveryStatus  (PENDING | SENT | FAILED) │
   │ emailErrorMessage                              │
   │                                                │
   │ UNIQUE (visaId, thresholdDays, recipient)      │
   │   ← this is the idempotency anchor            │
   └────────────────────────────────────────────────┘
```

The unique constraint is the heart of this PR. Every code path that wants to "send a reminder" first checks whether the matching ledger row already exists; if it does, the dispatch is skipped and a `VISA_EXPIRY_REMINDER_SKIPPED` audit row is written instead. That means:

* The daily cron can fire safely multiple times per day (e.g. after a backend restart) without re-blasting.
* The manual `run-sweep-now` endpoint is safe to call from any environment.
* Migrating between staging and prod cannot accidentally re-send reminders that the dev/staging cron already fired.

`recipientUserId` is nullable on purpose: the OWNER recipient fans out across every active OWNER user, but we record one ledger row per (visa, threshold, OWNER) — the unique constraint enforces this. For LIA and CLIENT recipients, `recipientUserId` carries the actual target user id (handy for audit).

---

## 3. Backend — files added / modified

### New (4)

* [backend/src/visa-expiry/visa-expiry.service.ts](../backend/src/visa-expiry/visa-expiry.service.ts) — `@Cron`-decorated `runDailySweep`, `dispatchRemindersForThresholds`, `getExpiringSoon`, helper `dayWindow` (Pacific/Auckland anchor)
* [backend/src/visa-expiry/visa-expiry.controller.ts](../backend/src/visa-expiry/visa-expiry.controller.ts) — `GET /staff/visa-expiry/expiring-soon`, `POST /staff/visa-expiry/run-sweep-now`
* [backend/src/visa-expiry/visa-expiry.module.ts](../backend/src/visa-expiry/visa-expiry.module.ts) — registers `ScheduleModule.forRoot()` locally (not in AppModule)
* [backend/prisma/migrations/20260527030000_pr_lia_9_visa_expiry_reminders/migration.sql](../backend/prisma/migrations/20260527030000_pr_lia_9_visa_expiry_reminders/migration.sql)

### Modified (4)

* [backend/prisma/schema.prisma](../backend/prisma/schema.prisma) — `enum VisaExpiryReminderRecipient`, `model VisaExpiryReminderSent`, `expiryReminders VisaExpiryReminderSent[]` on `Visa`
* [backend/src/app.module.ts](../backend/src/app.module.ts) — register `VisaExpiryModule`
* [backend/src/notifications/notifications.service.ts](../backend/src/notifications/notifications.service.ts) — `sendVisaExpiryReminderToLia`, `sendVisaExpiryReminderToClient`, `sendVisaExpiryReminderToOwner`
* [backend/src/common/audit/audit.helper.ts](../backend/src/common/audit/audit.helper.ts) — five new event-type cases in `summarizeAuditEntry`

---

## 4. Frontend — files added / modified

### New (2)

* [frontend/src/app/lia/expiring-soon/page.tsx](../frontend/src/app/lia/expiring-soon/page.tsx) — server-rendered queue with 7/14/30/90-day chip filter, days-remaining colour bands, sent-pill columns
* [frontend/src/app/lia/expiring-soon/RunReminderSweepButton.tsx](../frontend/src/app/lia/expiring-soon/RunReminderSweepButton.tsx) — OWNER-only confirmation overlay → POST sweep → result toast

### Modified (3)

* [frontend/src/app/lia/page.tsx](../frontend/src/app/lia/page.tsx) — 6th stat card (Expiring soon, Clock icon, amber when count > 0)
* [frontend/src/components/portal/PortalLayout.tsx](../frontend/src/components/portal/PortalLayout.tsx) — "Expiring Soon" sidebar nav item (Clock icon, no role gate)
* [frontend/src/app/lia/cases/[id]/page.tsx](../frontend/src/app/lia/cases/[id]/page.tsx) — `<VisaExpiryBanner>` (amber/orange/red/maroon strip at the top when the case's approved visa is ≤30 days out or already expired)

---

## 5. Cron schedule

```ts
@Cron('0 9 * * *', { name: 'visaExpiryDailySweep', timeZone: 'Pacific/Auckland' })
```

Crucially explicit timezone — without it, the schedule expression resolves against the server's local TZ, which is unpredictable on Render / DigitalOcean App Platform. Pacific/Auckland means "09:00 NZ time regardless of where the box is" and stays correct across DST shifts.

The cron is registered inside `VisaExpiryModule.forRoot()` (via `ScheduleModule.forRoot()`) rather than in `AppModule`. That keeps test suites that import a narrower module subgraph from accidentally scheduling background work.

---

## 6. Routes (new)

| Verb | Path | Auth | Notes |
|---|---|---|---|
| GET | `/staff/visa-expiry/expiring-soon` | LIA / ADMIN / SUPER_ADMIN / OWNER | optional `?thresholdDays=N` (default 30, clamped 1–365) |
| POST | `/staff/visa-expiry/run-sweep-now` | **OWNER / ADMIN / SUPER_ADMIN** (intentionally not LIA) | manual trigger; safe to spam |

Both return `401` unauthenticated. The LIA gate on `run-sweep-now` is intentional — we don't want a curious LIA to accidentally blast production emails.

---

## 7. Audit events (new)

* `VISA_EXPIRY_REMINDER_SENT_LIA` — `newValue: { visaId, thresholdDays, recipient, recipientCount, emailDeliveryStatus }`
* `VISA_EXPIRY_REMINDER_SENT_CLIENT` — same shape
* `VISA_EXPIRY_REMINDER_SENT_OWNER` — same shape; `recipientCount` reflects the fan-out count
* `VISA_EXPIRY_REMINDER_SKIPPED` — `newValue: { visaId, thresholdDays, recipient, reason: 'already-sent', existingSentAt }`
* `VISA_EXPIRY_MANUAL_SWEEP_TRIGGERED` — `newValue: { dispatched, skipped, failed }`; written by the controller (top-level), not per-reminder

All five are surfaced through `summarizeAuditEntry` in [audit.helper.ts](../backend/src/common/audit/audit.helper.ts).

---

## 8. Operational notes

* **If the backend is down for >24h at 09:00 NZ, no reminders fire during that window.** Recovery: hit `POST /staff/visa-expiry/run-sweep-now` after the backend is back up. The unique constraint guarantees only the day-of-the-outage's missed reminders go out — earlier days' reminders are still considered "sent."
* **The cron fires at 09:00 Pacific/Auckland time.** This is hardcoded in the `@Cron` decorator. Changing it requires a code edit and redeploy. No env-var configuration on purpose — keeping the operational surface small.
* **Per-recipient deduplication via UNIQUE (visaId, thresholdDays, recipient).** Re-running the sweep is idempotent. The OWNER fan-out is also deduplicated: one ledger row per (visa, threshold, OWNER) even though up to N emails go out — we don't want to blast every OWNER on every retry.
* **Email failure does not retry.** A FAILED reminder is recorded as such in the ledger. The next day's automatic sweep sees the existing ledger row and skips. To retry, OWNER can manually delete the FAILED row and re-trigger the sweep, or call the underlying service from a future admin tool.
* **Reverting a visa record cascades the ledger.** PR-LIA-8's revertVisaRecord deletes the Visa row, and the FK cascade drops the reminder ledger rows with it. That matches expectations: a reverted visa shouldn't keep "30-day reminder already sent" state hanging around.
* **The cron stays inside the existing `sorena-backend` PM2 process** (per Option A in the spec). No PM2 ecosystem changes; no separate worker. PM2's restart-on-crash handles the lifecycle.

---

## 9. Constraints honoured

* Exactly one new npm dependency: `@nestjs/schedule@^6.1.3`
* No new env vars (schedule + timezone hardcoded in the decorator)
* No touches to PR-LIA-8's visa lifecycle endpoints
* Audit-log written on every dispatched reminder AND every skip
* Skipped reminders write a distinct `VISA_EXPIRY_REMINDER_SKIPPED` event
* `req.user?.userId ?? req.user?.id` everywhere — d95640d preserved
* All three notification methods wrap their underlying send in `safeSend` (try/catch, log, never throw)
* Reminder ledger rows survive `revertVisaRecord` via the FK cascade design (they go away with the visa, which is the right semantic — there's no "soft revert" path)

---

## 10. Backlog

* **PR-LIA-9.1 — SMS reminders.** Twilio integration; same dispatcher shape but emits SMS to the client's `contact.phone` instead of email. New `VisaExpiryReminderRecipient` value or a sibling `VisaExpirySmsReminderSent` table; spec-level decision later.
* **PR-LIA-9.2 — Configurable thresholds.** Pull `[30, 14, 7]` out of code and into a `PlatformSetting` row. Probably needs an OWNER-only admin tool to edit. Care needed around adding/removing thresholds mid-life — existing ledger rows reference removed thresholds, and adding a threshold that's already passed for some visas would re-fire on those.
* **PR-LIA-9.3 — Renewal workflow.** When LIA clicks "Start renewal" on a reminder, generate a new Case (or extend the existing one) with `stage: VISA` so the application + INZ-submit flow can run again. Likely shares 70 % of PR-LIA-7/8's code.
* **PR-LIA-9.4 — Persian/Farsi email templates.** Currently English-only. The platform already has Persian locale support — extend the existing i18n hooks to email templates.
* **OWNER-facing "failed reminders" view.** The ledger already records `emailDeliveryStatus = FAILED` with `emailErrorMessage`. A small surface that lists FAILED rows + a "retry" button would close the loop.
* **Reminder analytics on the productivity report.** PR-LIA-3 ranks LIAs on case throughput; a future column could count "reminders that led to renewal conversations within N days."
* **Snooze / opt-out.** Some clients won't want reminders (e.g. they're returning home). Add `clientOptedOutAt DateTime?` on User; the dispatcher filters them out + writes a `VISA_EXPIRY_REMINDER_SKIPPED` audit row with reason `client-opted-out`.
* **Holiday awareness.** Skip the cron on NZ public holidays. Low priority — Sorena's volume is small enough that 09:00 reminders on Christmas Day aren't operationally costly.
* **Cron observability.** A FAILED row in the ledger is currently the only signal that anything went wrong. A small `/health/visa-expiry` route returning "last sweep ran at X, dispatched Y" would help on-call.
