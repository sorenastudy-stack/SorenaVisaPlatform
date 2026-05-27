# PR-SCORECARD-4 — Wix-driven booking + payment integration

## 1. Purpose

Sorena does NOT host any payment UI. All bookings and payments live on the
Wix website. PR-SCORECARD-4 wires Sorena to that decision in three
deliverables:

1. **OWNER-editable booking URLs** — the three destinations the public
   scorecard result page sends users to (Free 15-min, NZD 30
   Gap-Closing, NZD 150 LIA Consultation) live in `PlatformSetting`
   rows so OWNER can swap them without a deploy.
2. **Wix Automations webhook listener** — `POST /webhooks/wix/payment`
   records every confirmed payment or booking in the new `wix_payments`
   table. Authenticated via the `X-Sorena-Webhook-Secret` shared
   header, rotatable in-place from `/staff/platform-settings`.
3. **Staff payments browser** — `/staff/wix-payments[/:id]` lists every
   recorded webhook hit with filters, status badges, and the raw Wix
   payload (collapsed by default, audit-logged on view).

No Stripe SDK, no Stripe webhooks, no payment UI on Sorena. One commit
for the entire PR.

## 2. Schema changes

Migration: `20260527170000_pr_scorecard_4_platform_settings_and_wix_payments`

### `platform_settings` — extended

Pre-existing model (`{key, value, updatedAt, updatedById}`) extended in
place:

- New columns: `id` (uuid PK), `description` (nullable text),
  `category` (varchar 50, default `general`), `createdAt`.
- Primary key migrated from `key` to `id`; `key` is now `UNIQUE`.
- New index on `category`.
- New FK `updatedById → users.id`.
- Seeded 4 rows (idempotent on `key`):
  - `BOOKING_URL_FREE_15MIN` → Wix Bookings URL
  - `BOOKING_URL_GAP_CLOSING` → Wix payment URL (NZD 30)
  - `BOOKING_URL_LIA_CONSULTATION` → Wix payment URL (NZD 150)
  - `WIX_WEBHOOK_SECRET` → 64-char hex from `gen_random_bytes(32)`
    (pgcrypto extension created in this migration too).

Two coexisting conventions live in this table:

- **Legacy** (owner-approval queue `CHANGE_PLATFORM_SETTING` executor):
  `value` is AES-256-GCM ciphertext. The OwnerApprovalService still
  writes encrypted values for arbitrary OWNER-approved settings.
- **PR-SCORECARD-4** (booking_urls + wix_integration categories):
  `value` is plaintext. `PlatformSettingsService` writes these.
  `WIX_WEBHOOK_SECRET` is plaintext at-rest but ALWAYS masked at the
  API boundary (`●●●●●●●● (hidden)`) except on regeneration.

### `wix_payments` — new

```
WixPaymentType  ::= FREE_15MIN | GAP_CLOSING | LIA_CONSULTATION | OTHER
WixPaymentStatus ::= RECEIVED | REFUNDED | DISPUTED

wix_payments
  id uuid PK
  wixPaymentId varchar(200) UNIQUE          -- idempotency key
  wixBookingId varchar(200) NULL
  paymentType WixPaymentType
  amount DECIMAL(10,2)
  currency varchar(3)
  status WixPaymentStatus DEFAULT 'RECEIVED'
  customerEmail varchar(200)
  customerName/Phone/bookingStart/End/Location ...
  matchedLeadId FK → leads(id) ON DELETE SET NULL
  matchedUserId FK → users(id) ON DELETE SET NULL
  rawPayload JSONB                          -- forensic value
  receivedAt timestamp DEFAULT now
```

Indexes on `(customerEmail, receivedAt)`, `matchedLeadId`,
`(paymentType, receivedAt)`, `status`. Linkage to Lead / User is
best-effort match by email at write time; the row is informational —
we never auto-update `leadStatus` from a payment per strategic decision.

## 3. Backend modules

### `platform-settings/`

- `PlatformSettingsService.list` / `get` / `update` /
  `regenerateWebhookSecret` / `getInternal` /
  `getBookingUrls`. `getInternal` is the back-door used by the
  webhook controller; never expose it. Masking happens in `hydrate()`.
- `PlatformSettingsController` → `/staff/platform-settings/*`,
  OWNER/SUPER_ADMIN only.
- DTO with class-validator URL+length guard.
- Module exported so ScorecardModule + WixIntegrationModule can read.

### `wix-integration/`

- `WixPaymentsService.recordPayment` — signature verification via
  `timingSafeEqual`, idempotency on `wixPaymentId`, payment-type
  inference from `productName + amount + currency`, best-effort
  email-match to Lead+User, transactional insert + audit.
- Rejection path writes `WIX_PAYMENT_WEBHOOK_REJECTED` audit row with
  IP + first-8 chars of the provided secret (forensic without leak).
- `WixWebhookController` → `POST /webhooks/wix/payment`, public,
  shared-secret authenticated, route-scoped `@Throttle(60/min)` and
  reused `WixWebhookExceptionFilter` from PR-WIX-1 so structured
  `{ error: "invalid_signature" }` body survives the global filter.
- `WixPaymentsController` → `/staff/wix-payments[/:id]` +
  `/staff/wix-payments/lead/:leadId`,
  OWNER/SUPER_ADMIN/ADMIN/FINANCE. Detail view writes
  `WIX_PAYMENT_VIEWED` audit row.

### `scorecard/scorecard-public.controller.ts`

- `GET /scorecard/booking-urls` — public, no auth. Reads through
  `PlatformSettingsService.getBookingUrls()`. 60-second in-memory
  cache keeps the DB cool under bursty scorecard completions.

## 4. Audit events

Added to `common/audit/audit.helper.ts`:

- `PLATFORM_SETTING_UPDATED` — "Platform setting updated: KEY"
- `WIX_WEBHOOK_SECRET_REGENERATED` — "Wix webhook secret regenerated"
- `WIX_PAYMENT_RECORDED` — "Wix payment recorded: TYPE AMOUNT CCY"
- `WIX_PAYMENT_WEBHOOK_REJECTED` — "Wix payment webhook rejected (from IP)"
- `WIX_PAYMENT_VIEWED` — "Wix payment detail viewed by staff"

## 5. Frontend changes

- `lib/scorecard/booking-urls.ts` — replaced `BOOKING_URLS` constant
  with `getBookingUrls(): Promise<BookingUrls>` that fetches
  `/scorecard/booking-urls`, with module-level cache + in-flight
  dedup + fallback constants on network failure.
- `components/scorecard/ScorecardResultClient.tsx` — fetches URLs on
  mount via `useEffect`, starts with `FALLBACK_BOOKING_URLS` so
  buttons are usable immediately, then upgrades to the OWNER-edited
  values.
- `app/staff/platform-settings/page.tsx` — booking URLs list with
  edit-in-modal, Wix webhook endpoint + secret display with
  regenerate flow (confirm modal → success modal showing plaintext
  once → masked forever).
- `app/staff/platform-settings/wix-setup/page.tsx` — 5-step Wix
  Automations setup guide with copy-paste endpoint + JSON body
  template.
- `app/staff/wix-payments/page.tsx` — table with filters
  (type/status/email/since), empty-state pointing at setup guide,
  link to matched lead.
- `app/staff/wix-payments/[id]/page.tsx` — customer block + booking
  block + Sorena match block + collapsible raw payload pane.
- `app/sales/leads/[id]/LeadWixPayments.tsx` — inline panel on lead
  detail; 403 → silently hidden so non-finance roles don't see
  empty section.
- `components/staff/shell/StaffSidebar.tsx` — two new entries:
  "Wix payments" (4 roles) and "Platform settings" (OWNER+SUPER_ADMIN).
- `i18n/messages/{en,fa}.json` — translation keys for the two new
  sidebar items.

## 6. Test + validation

- Migration applied: `npx prisma migrate deploy` → all 51 applied.
- Prisma client regenerated.
- Backend `npx tsc --noEmit` → clean (exit 0).
- Frontend `npx tsc --noEmit` → clean (exit 0).
- Scorecard tests: `npx jest src/scorecard/scoring/scoring.spec.ts`
  → **40 / 40 pass**.
- 9 smoke probes (see §7).

## 7. Smoke probes

```
GET    /staff/platform-settings                                → 401
PATCH  /staff/platform-settings/BOOKING_URL_FREE_15MIN         → 401
POST   /staff/platform-settings/wix-webhook-secret/regenerate  → 401
GET    /staff/wix-payments                                     → 401
GET    /staff/wix-payments/abc123                              → 401
GET    /scorecard/booking-urls                                 → 200
       { FREE_15MIN, GAP_CLOSING_PAYMENT, LIA_CONSULTATION }
POST   /webhooks/wix/payment   (no header)                     → 401
       { "error": "invalid_signature" }
POST   /webhooks/wix/payment   (wrong header)                  → 401
       { "error": "invalid_signature" }
POST   /webhooks/wix/payment   (valid + valid payload)         → 200
       { "status": "ok", "paymentId": "...", "wixPaymentId": "..." }
       → wix_payments row created
       → idempotent retry returns same paymentId (verified count=1
         after second POST with same wixPaymentId)
```

Sample curl that recorded a real test payment (smoke test row was
cleaned up post-verification):

```bash
SECRET=<paste from /staff/platform-settings>
curl -X POST http://localhost:3001/webhooks/wix/payment \
  -H "Content-Type: application/json" \
  -H "X-Sorena-Webhook-Secret: $SECRET" \
  -d '{"paymentId":"smoke-001","amount":30,"currency":"NZD",
       "productName":"Gap-Closing Roadmap Session",
       "customer":{"email":"smoke@example.com","name":"Smoke Test"}}'
```

## 8. Wix Automations setup

Step-by-step instructions are rendered at
`/staff/platform-settings/wix-setup` (linked from
`/staff/platform-settings`). The page is documentation only — no
data fetching. Verified renders.

## 9. Operational notes

- **Path divergence**: this PR's webhook lives at `/webhooks/wix/payment`
  (matches the spec). PR-WIX-1's lead-capture lives at
  `/api/webhooks/wix/lead-capture`. Two separate controllers in two
  separate modules; documented at the top of `wix-webhook.controller.ts`.
- **Secret rotation playbook**: regenerate via the OWNER UI → copy
  shown-once plaintext → paste into Wix Automation header → save.
  The `WIX_WEBHOOK_SECRET` value is fail-closed: if missing or
  mismatched, the webhook returns 401 without writing.
- **No new env vars, no new npm deps**.
- **d95640d JWT pattern** (`req.user?.userId ?? req.user?.id`)
  preserved on both new controllers.
- **Hand-written migration only** — no `prisma migrate dev`.

## 10. Backlog (deferred to future PRs)

- Auto-link Wix payments to ScorecardSubmission ID (currently
  email-only match).
- Refund / dispute handling — current implementation accepts the
  enum values but no inbound flow actions them yet.
- Email confirmation to the customer when a payment lands.
- Push notification to staff Slack/Discord on every payment.
- Bulk export of `wix_payments` to CSV for reconciliation.
- Daily reconciliation report comparing Wix payment count to
  Sorena `wix_payments` count.
- Auto-update lead status on payment (intentionally NOT done in this
  PR per Q3 = B; payments are recorded, not actioned).
