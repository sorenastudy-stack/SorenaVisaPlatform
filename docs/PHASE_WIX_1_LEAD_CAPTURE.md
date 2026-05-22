# PR-WIX-1 — Wix lead-capture webhook

Public webhook endpoint that receives Wix form submissions and creates `Lead` rows (with linked `Contact`) in the platform. This is the first inbound integration with Wix; future PRs may add a paid-event webhook, a Wix-booking-completed webhook, or a CMS sync, all under the same `/api/webhooks/wix/*` namespace.

## 1. What this PR does

Adds `POST /api/webhooks/wix/lead-capture` — a public, un-authed-but-shared-secret-guarded endpoint that accepts a Wix form-submission payload, normalises it through a fuzzy field matcher (Wix doesn't publish a single canonical payload shape), upserts a `Contact` by email, and creates a `Lead` with `sourceChannel = 'WIX_LEAD_CAPTURE'`.

Idempotency is enforced via a new `externalSubmissionId` column on `Lead` (unique, `String?`). The webhook computes the key as `sha256(email + '|' + submittedAt + '|' + secret).slice(0,32)`. Wix retries that hit the same email-in-the-same-minute collapse onto the same row and return `{ status: 'duplicate', leadId }` instead of double-creating.

Three sibling columns ride along on the migration: `currentEducationLevel` (free text, ≤100 chars), `countryRaw` (the un-resolved country string when the ISO 3166-1 alpha-2 normaliser fails), and `webhookMetadata` (JSON: page URL, form id, original payload keys — useful for debugging unfamiliar Wix shapes).

Auth: shared secret in `x-sorena-webhook-secret` header, compared via `timingSafeEqual`. Misconfigured backend (no `WIX_WEBHOOK_SECRET` env var) fails closed.

Audit: every successful capture writes one `audit_logs` row with `eventType = 'WIX_LEAD_CAPTURED'`, `actorNameSnapshot = 'Wix Webhook'`, `actorRoleSnapshot = 'SYSTEM'`, and `newValue = { leadId, source: 'WIX', email_masked: 'a***@example.com' }`. The masked email lets us trace a submission without leaking PII into the log.

Rate limit: route-level `@Throttle({ default: { ttl: 60_000, limit: 60 } })` on top of the global 60/min default. Wix's own rate limits dominate in practice; this is a belt-and-braces backstop.

No frontend changes. No new packages.

## 2. Files changed

Backend (new):
- `prisma/migrations/20260522000000_pr_wix_1_lead_capture_fields/migration.sql` — adds four columns to `leads` + unique index on `externalSubmissionId`.
- `src/webhooks/wix/wix-webhooks.module.ts`
- `src/webhooks/wix/wix-webhooks.controller.ts` — single `POST /api/webhooks/wix/lead-capture` route.
- `src/webhooks/wix/wix-webhooks.service.ts` — orchestrates normalisation → validation → dedupe → contact upsert → lead create → CrmEvent + audit log emit.
- `src/webhooks/wix/wix-payload-normaliser.ts` — depth-first JSON walker with fuzzy field-name matching (`fullname`, `full_name`, `"Full Name"`, etc. all collapse).
- `src/webhooks/wix/guards/wix-secret.guard.ts` — `timingSafeEqual` comparison against `WIX_WEBHOOK_SECRET`.
- `src/webhooks/wix/dto/wix-lead-capture.dto.ts` — type marker only (no class-validator at the boundary; the normaliser handles the variable shape).
- `test/wix-sample-payload.json` — realistic Wix payload for the curl examples.
- `test/wix-webhook-curl-examples.md` — 7 local-curl walkthroughs (canonical, flat, label-style, country fallback, missing email, bad secret, DB verify).

Backend (existing):
- `prisma/schema.prisma` — `Lead` gains `currentEducationLevel`, `externalSubmissionId @unique`, `countryRaw`, `webhookMetadata Json?`.
- `src/app.module.ts` — registers `WixWebhooksModule`.
- `src/common/country-codes.ts` — adds `getAlpha2CodeFromName` (reverse lookup, name → alpha-2).
- `src/common/audit/audit.helper.ts` — summarises `WIX_LEAD_CAPTURED` events.
- `.env.example` — adds `WIX_WEBHOOK_SECRET=""` with the generation one-liner in the comment.

No schema changes outside the four nullable Lead columns. No new env vars beyond `WIX_WEBHOOK_SECRET`. No new dependencies.

## 3. Schema added

```prisma
model Lead {
  // ... existing columns ...
  currentEducationLevel   String?
  externalSubmissionId    String?  @unique
  countryRaw              String?
  webhookMetadata         Json?
}
```

All four nullable. The unique index on `externalSubmissionId` is the dedupe guarantee — two retries of the same Wix submission produce the same key and the second insert fails with `P2002`. We catch the dedupe path *before* the insert (a `findUnique` check inside the service) so the conflict never reaches the wire, but the index is the belt under the suspenders.

## 4. Endpoint contract

### Route
`POST /api/webhooks/wix/lead-capture`

### Headers
- `x-sorena-webhook-secret: <secret>` — required; must match `WIX_WEBHOOK_SECRET` env var. Compared with `timingSafeEqual`. Failure → 401.
- `content-type: application/json`

### Accepted payload shapes

The normaliser walks the entire JSON tree depth-first and collects every leaf value keyed by its lowercased, punctuation-stripped field name. It then picks the first match for each canonical field from a synonym list:

| Canonical field | Synonyms (fuzzy match — lower-case, no spaces/underscores/dashes/dots) |
|---|---|
| `fullName` | `fullname`, `name`, `fullnamelabel`, `firstandlastname`, `firstname`, `givenname`, `studentname` |
| `email` | `email`, `emailaddress`, `emailaddr`, `contactemail`, `studentemail` |
| `phone` | `phone`, `phonenumber`, `mobile`, `mobilenumber`, `contactphone`, `studentphone`, `tel`, `telephone` |
| `countryOfResidence` | `countryofresidence`, `country`, `countrycode`, `residencecountry`, `currentcountry`, `location` |
| `currentEducationLevel` | `currenteducationlevel`, `educationlevel`, `highesteducation`, `highesteducationallevel`, `qualification`, `highestqualification`, `education`, `level` |

The normaliser also handles arrays of `{name, value}` pairs (a common Wix-forms shape) by surfacing each as `{ <name>: <value> }` before walking.

Envelope fields (top-level only): `submissionId`, `submittedAt`, `pageUrl`, `formId` — accepted under their canonical names or any case-variant.

### Validation

Inside the service:
- `email` — required, lenient regex (`^[^\s@]+@[^\s@]+\.[^\s@]+$`), ≤255 chars. Failure → 400 `INVALID_PAYLOAD`.
- `fullName` — required, 1–160 chars after trim. Failure → 400.
- `phone` — optional; must match `/^[+0-9 ()\-]{5,32}$/` to be stored, else silently dropped.
- `countryOfResidence` — optional; if exactly 2 uppercase letters of a valid alpha-2 code → stored on Contact. Else name → alpha-2 via `i18n-iso-countries`. Else stored on `Lead.countryRaw`.
- `currentEducationLevel` — optional, free text, truncated to 100 chars.

### Response shapes

| Status | Body |
|---|---|
| 200 success (created) | `{ "status": "created", "leadId": "<cuid>" }` |
| 200 success (duplicate within secret-bounded dedupe key) | `{ "status": "duplicate", "leadId": "<existing-cuid>" }` |
| 400 bad payload | `{ "status": "error", "error": "INVALID_PAYLOAD", "message": "..." }` |
| 401 bad / missing secret | `{ "status": "error", "error": "INVALID_SECRET" }` |
| 429 rate-limited | `{ "status": "error", "error": "RATE_LIMITED" }` (from throttler) |

We deliberately don't 5xx on partial success — Wix retries 5xx aggressively and the asymmetric "lead is fine but we couldn't tell you that" outcome is worse than no lead at all.

### Dedupe semantics

`externalSubmissionId = sha256(email_lower + '|' + submittedAt_iso + '|' + WIX_WEBHOOK_SECRET).slice(0, 32)`

- `email_lower` is `.toLowerCase().trim()`.
- `submittedAt_iso` is the inbound `submittedAt` ISO string if present and parseable, else the current server time floored to the minute.
- The secret is included so an attacker who can guess the email + minute can't pre-compute a colliding key to poison the dedupe table.

Two retries of the same submission within the same minute → same key → second one returns `{ status: 'duplicate' }`. A user re-submitting the same form an hour later with a fresh `submittedAt` → different key → creates a second Lead (which is correct: they intended to submit twice).

## 5. Configuration

### `WIX_WEBHOOK_SECRET`

Required for the endpoint to accept any request. Generate with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add to `backend/.env`:

```
WIX_WEBHOOK_SECRET="<the-generated-hex-string>"
```

(For this branch, a fresh value was already generated and appended; see `backend/.env`.)

On the Wix side, configure the form's submission webhook to POST to the route below with the header `x-sorena-webhook-secret: <the-same-value>`.

### Webhook URL

- **Local dev** — `http://localhost:3001/api/webhooks/wix/lead-capture`
- **Local with ngrok** — `https://<your-subdomain>.ngrok-free.dev/api/webhooks/wix/lead-capture`
- **Production** — `https://<production-backend-domain>/api/webhooks/wix/lead-capture` (set by the Vercel deployment domain). Update Wix's webhook URL to the production value before the form goes live.

### Wix integration steps (for ops)

1. In Wix Editor → Forms → your lead-capture form → Settings → Submission settings → "Send form data to URL".
2. URL: the chosen webhook URL above.
3. Method: POST.
4. Headers: add `x-sorena-webhook-secret` with the `.env` value.
5. Save & test. The first test submission should appear via the SQL query in section 7 of `test/wix-webhook-curl-examples.md`.

## 6. How to test (manual)

1. **Type-check clean:** `cd backend && npx tsc --noEmit` exits clean.
2. **Migration applied:** `npx prisma migrate status` shows `20260522000000_pr_wix_1_lead_capture_fields` applied.
3. **Schema columns exist:** `\d leads` shows `currentEducationLevel`, `externalSubmissionId`, `countryRaw`, `webhookMetadata`.
4. **Start backend:** `npm run dev`. Wait for "Nest application successfully started".
5. **Run curl 1** from `test/wix-webhook-curl-examples.md` → 200 `created`. Note the leadId.
6. **Re-run the same curl** → 200 `duplicate` with the same leadId. No new row.
7. **Run curls 2 and 3** — each creates a new lead (different emails / submitted-at values).
8. **Run curl 4** (Middle Earth country) — 200 `created`. Verify the lead row has `countryRaw = 'Middle Earth'` and the linked Contact's `countryOfResidence` is null.
9. **Run curl 5** (missing email) → 400 INVALID_PAYLOAD.
10. **Run curl 6** (bad secret) → 401 INVALID_SECRET.
11. **Inspect the audit log:**
    ```sql
    SELECT id, "eventType", "actorNameSnapshot", "newValue", "createdAt"
      FROM audit_logs
     WHERE "eventType" = 'WIX_LEAD_CAPTURED'
     ORDER BY "createdAt" DESC LIMIT 5;
    ```
    Expect one row per `created` curl, with `email_masked` like `r***@example.com`.
12. **Rate-limit (optional, manual):** burst 65 requests in 60 seconds with the same secret → the 61st+ comes back 429.

## 7. Known limitations

- **No frontend leads list yet.** The lead is queryable via the existing `/leads` endpoint and visible in any future staff-leads page. PR-CONSULT-2's case list doesn't surface leads (separate table). A future PR can add `/staff/leads`.
- **`source` field is `sourceChannel: String`, not an enum.** The existing schema uses a free-text column; the value `'WIX_LEAD_CAPTURE'` is just one more string. If a future PR consolidates sources into a `LeadSource` enum, this PR's writes will need a one-line update.
- **Dedupe key includes the secret.** Rotating `WIX_WEBHOOK_SECRET` means the dedupe-key space shifts — a submission Wix retries across a rotation will create a fresh lead because the new key won't match the old row. Acceptable for the rare rotation case; documented here so ops doesn't get surprised.
- **No request-body schema validation at the boundary.** The normaliser tolerates basically any JSON. If a future PR tightens the contract (e.g. once Wix's actual shape is known + frozen), we can introduce a class-validator DTO and reject obviously malformed payloads earlier.
- **Phone format is permissive.** Anything matching `/^[+0-9 ()\-]{5,32}$/` passes. We don't normalise to E.164 — that would need a `libphonenumber-js`-style dependency and a country-of-issue guess.
- **Audit attribution is "Wix Webhook / SYSTEM".** The PR-CONSULT-4 snapshot columns carry the synthetic identity; no real User row backs it. The staff case-detail activity feed shows it as a system event.
- **No retry-with-exponential-backoff on transient DB errors.** If Postgres is briefly down the webhook returns 500 → Wix retries on its own schedule. Acceptable for a low-volume integration; revisit if Wix's retry policy turns out to be hostile.

## 8. How to extend

- **Add another Wix webhook** (e.g. `paid-event`, `booking-completed`). Create another controller route under the same controller — or a sibling controller in `src/webhooks/wix/` — guarded by the same `WixSecretGuard`. Reuse the normaliser if the inbound shape is loose; switch to a class-validator DTO if it's strict.
- **Surface the unresolved `countryRaw`** in the staff leads list. Add a column to the row + a small "needs review" affordance when `countryRaw != null` and `countryOfResidence == null` on the linked Contact.
- **Add a `LeadSource` enum.** Migration: `CREATE TYPE "LeadSource" AS ENUM (...)`. Backfill `sourceChannel` values. Drop the string column. Update this service to write to the enum column. The webhook payload contract is unaffected.
- **Wire scoring** (currently only `PublicService` runs the scoring engine on intake). Inject `ScoringService` into `WixWebhooksService` and call it inside the transaction once the lead is created; mirror the `PublicService.submitIntakeForm` body around lines 102-166 minus the high-risk engine if you don't need it.
- **Add Slack notification** on every webhook capture. Inject `NotificationsService` and fire an out-of-band Slack call after the transaction commits.

## 9. Security layers applied

- **Layer 1 — shared secret:** `WixSecretGuard` validates `x-sorena-webhook-secret` against `WIX_WEBHOOK_SECRET`. `timingSafeEqual` comparison; misconfigured backend (empty secret) fails closed.
- **Layer 2 — rate limit:** route-level `@Throttle({ default: { ttl: 60000, limit: 60 } })` on top of the global 60/min throttler default. Per-IP.
- **Layer 3 — dedupe via secret-bound hash:** `externalSubmissionId` includes the secret, so a third party who can guess email + minute can't poison the table from outside.
- **Layer 4 — audit attribution:** `actorNameSnapshot = 'Wix Webhook'` + `actorRoleSnapshot = 'SYSTEM'` so the activity feed reads cleanly even when the User join is null (it always is for this path).
- **Layer 5 — email masked in audit:** `newValue.email_masked` stores `"r***@example.com"` rather than the full address. Audit-log readers don't need the inbox half.
- **Layer 6 — fail-soft on partial data:** Phone / country / education are best-effort. We'd rather land a partial lead and follow up than reject + force Wix to retry forever.
- **Layer 7 — fail-loud on shape errors:** missing email or fullName → 400 directly. Wix shouldn't retry 400s; the form's owner sees the rejection on the Wix side.
- **Layer 8 — country normaliser is whitelist-validated:** alpha-2 codes pass `isValidCountryCode` (matches `i18n-iso-countries`' live set), country names pass through the same library's reverse lookup. Anything unrecognised becomes `countryRaw` — never silently mapped to a "close" code.
- **Layer 9 — Contact upsert is by unique email.** No risk of creating two Contact rows per person; the upsert merges into the existing row when the email is already known.
- **Layer 10 — no plaintext secret in logs.** The service logs the masked email + the dedupe key (which is a 32-char sha256 prefix, not the secret), never the inbound header value.

## 10. Rollback procedure

```bash
# 1. revert the two commits (feature + handover)
git revert HEAD~1..HEAD

# 2. drop the new Lead columns + unique index
psql -d sorenavisaplatform <<SQL
DROP INDEX IF EXISTS "leads_externalSubmissionId_key";
ALTER TABLE "leads"
  DROP COLUMN IF EXISTS "currentEducationLevel",
  DROP COLUMN IF EXISTS "externalSubmissionId",
  DROP COLUMN IF EXISTS "countryRaw",
  DROP COLUMN IF EXISTS "webhookMetadata";

DELETE FROM _prisma_migrations
  WHERE migration_name = '20260522000000_pr_wix_1_lead_capture_fields';
SQL

# 3. push the revert
git push origin main

# 4. tell Wix to stop posting to /api/webhooks/wix/lead-capture
#    (revert the URL on the Wix form's submission settings)
```

The DB backup taken before the migration lives at `backend/backup_before_pr_wix_1.sql` (gitignored). Restore from it if anything goes sideways — bypasses both the schema teardown and any leftover lead rows from the webhook.

A revert in production while Wix is still configured to POST means Wix will start seeing 404s; failures bubble into Wix's own retry queue but don't impact other parts of the platform. Removing the Wix-side webhook configuration is the cleanest follow-up.
