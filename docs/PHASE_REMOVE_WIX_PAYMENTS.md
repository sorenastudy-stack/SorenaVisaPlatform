# Phase: Remove Wix Payments (System A), Keep Wix Lead Capture (System B)

## 1. What it does

Removes the **Wix Payments integration** ("System A", `PR-SCORECARD-4`) everywhere. It was dead — 0 `WixPayment` rows ever recorded, the `WIX_WEBHOOK_SECRET` was never configured (so the webhook rejected every call), and no audit activity — so nothing real flowed through it.

Removed:
- Staff sidebar **"Wix payments"** nav item.
- The **Wix payments** list + detail pages (`/staff/wix-payments`).
- The **"Wix integration"** block in Platform settings (webhook endpoint URL + regenerate-secret) and the **Wix setup guide** page.
- The per-lead **`LeadWixPayments`** block on both lead-detail pages.
- The backend **public webhook** (`POST /webhooks/wix/payment`), the **staff API** (`GET /staff/wix-payments/*`), the **service**, and the **secret regenerate** endpoint.

**Wix LEAD CAPTURE ("System B", `PR-WIX-1`) is untouched and still live** — a separate webhook (`POST /api/webhooks/wix/lead-capture`) that ingests leads from a Wix form, plus the "Wix" lead source and `LeadSourceChip`. None of it was modified.

The now-orphaned, empty `wix_payments` table + its enums + Prisma relations are **left in place** (no migration).

## 2. Files deleted / changed

**Backend**
- `backend/src/app.module.ts` — unregistered `WixIntegrationModule` (import + module list entry).
- `backend/src/wix-integration/` — **deleted** (module, `wix-payments.service.ts`, `wix-webhook.controller.ts`, `wix-payments.controller.ts`).
- `backend/src/platform-settings/platform-settings.controller.ts` — removed `POST .../wix-webhook-secret/regenerate` route + now-unused `Post` import; refreshed the header comment.
- `backend/src/platform-settings/platform-settings.service.ts` — removed `regenerateWebhookSecret()`, emptied `MASKED_KEYS` (dropped `WIX_WEBHOOK_SECRET`), removed now-unused `randomBytes` import; refreshed comments (kept the generic `getInternal()`).

**Frontend**
- `frontend/src/components/staff/shell/StaffSidebar.tsx` — removed the "Wix payments" nav item, the `WIX_PAYMENT_ROLES` const, and the now-unused `CreditCard` import.
- `frontend/src/app/staff/wix-payments/` — **deleted** (`page.tsx` + `[id]/page.tsx`).
- `frontend/src/app/staff/platform-settings/wix-setup/page.tsx` — **deleted**.
- `frontend/src/app/staff/platform-settings/page.tsx` — removed the "Wix integration" card, its regenerate/new-secret modals, related state + imports, and the intro Wix sentence/link; **kept** Booking URLs + `EditUrlModal`.
- `frontend/src/app/sales/leads/[id]/LeadWixPayments.tsx` — **deleted**.
- `frontend/src/app/sales/leads/[id]/page.tsx` — removed the `LeadWixPayments` import + render.
- `frontend/src/app/staff/leads/[id]/page.tsx` — removed the `LeadWixPayments` import + render + the `wixPayments`/`totalPaidNzd` type fields.
- `frontend/src/i18n/messages/en.json` & `frontend/src/i18n/messages/fa.json` — removed the `staff.nav.wixPayments` key.

## 3. Database changes

**NONE.** `schema.prisma` is **untouched** — no migration, no `db execute`, no schema change. The `WixPayment` model, the `WixPaymentType` / `WixPaymentStatus` enums, and the `User.wixPayments` / `Lead.wixPayments` back-relations remain, now **orphaned** (empty table, 0 rows; the only remaining reader is the kept `staff-leads` relation read, which returns `false`/`0`). Dropping these physically would require a `prisma db execute` (deferred — see §8); harmless as-is.

## 4. Environment variables

**None removed.** Wix Payments had no env var — its shared secret lived in a `PlatformSetting` DB row (`WIX_WEBHOOK_SECRET`) that was never set. Nothing to change in `.env`. (`backend/.env.example` mentions Wix only for lead capture, which stays.)

## 5. Third-party services

**Wix Payments integration decommissioned.** No inbound Wix payment/booking webhook is accepted anymore. **Wix Lead Capture is retained** — the Wix form → `POST /api/webhooks/wix/lead-capture` pipe still works and is still secret-guarded.

## 6. How to test

- **Sidebar (OWNER):** the staff sidebar no longer shows a "Wix payments" item.
- **Platform settings (OWNER):** loads at `/staff/platform-settings` with the **Booking URLs** section intact and **no "Wix integration"** block; the `/staff/platform-settings/wix-setup` guide is gone.
- **Lead detail:** `/staff/leads/:id` and `/sales/leads/:id` load with **no Wix payments block** and make no call to a dead endpoint.
- **Routes gone:** `GET /staff/wix-payments` → **404**; `POST /webhooks/wix/payment` → **404** (0 route registrations at boot).
- **System B intact:** `POST /api/webhooks/wix/lead-capture` still registered (returns 401/validation, **not** 404); the "Wix" lead source still renders in the CRM.
- **Typecheck:** backend + frontend clean — no new errors (only pre-existing `scripts/test-slot-engine.ts:15` and `src/app/portal/booking/page.tsx` ×4).

Verified in this pass: route probes returned 404 (System A) / 401 (System B); OWNER render of platform-settings and both lead pages was clean; the Finance Portal (`finance@sorena.test`) still renders.

## 7. Known limitations

- The **staff leads _list_** page (`frontend/src/app/staff/leads/page.tsx`) still reads `hasWixPayments` / `totalPaidNzd` from the `/staff/leads` payload to show a "· NZD X paid" badge. These come from the retained backend leads service (always `false`/`0` now, so nothing renders) — **left dormant intentionally** to honour "leave the backend leads service relation read as-is." No dead-endpoint call, no error.
- The **orphaned empty `wix_payments` table + enums + relations** remain in the DB/schema (0 rows). Cosmetic only.

## 8. How to extend

To fully drop the orphaned structures later (optional, when ready to touch the DB):
1. First remove the remaining Prisma references so the client compiles without them: the `WixPayment` model + `WixPaymentType`/`WixPaymentStatus` enums, the `User.wixPayments` and `Lead.wixPayments` relation fields, and the `staff-leads.service.ts` relation read (+ the leads-list badge in §7).
2. Apply the drop via `prisma db execute` (this DB has migration-history drift, so **not** `migrate dev`):
   ```sql
   DROP TABLE IF EXISTS "wix_payments";
   DROP TYPE IF EXISTS "WixPaymentType";
   DROP TYPE IF EXISTS "WixPaymentStatus";
   ```
   then `prisma generate`. Requires explicit approval before running (data-affecting DDL).

## 9. Security

Removal **only reduces attack surface** — a public webhook (`/webhooks/wix/payment`), a staff read API, and an OWNER secret-regenerate endpoint are gone; no new exposure is introduced. The retained **Wix lead-capture webhook remains secret-guarded** (`WixSecretGuard`), unchanged. No secret was printed or committed; the never-set `WIX_WEBHOOK_SECRET` settings key simply no longer has a writer.

## 10. Rollback

Revert the commit — it restores all deleted files and the module registration, bringing System A back exactly as it was. Because the `wix_payments` table + enums + relations were **left orphaned (no migration, no data touched)**, there is **no data to restore** and nothing to un-drop. Rollback is pure code revert.
