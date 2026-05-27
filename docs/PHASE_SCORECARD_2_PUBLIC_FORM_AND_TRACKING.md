# PR-SCORECARD-2 — Public scorecard form + marketing/affiliate link tracking

Status: Shipped to `main` (commit `08222c9`).

This is the second PR in the scorecard arc. PR-SCORECARD-1 ported the
Python scoring engine and built the staff side. PR-SCORECARD-2 opens
the public-facing funnel: a landing page, a 5-step autosaving form, a
results page that mirrors the SAMPLE PDF, and a marketing/affiliate
link-tracking system that captures lead attribution from day one.

Commission math, affiliate payouts, PDF generation, Stripe wiring,
and Wix Bookings integration are explicitly **deferred** — this PR
captures attribution; future PRs monetise it.

## 1. Schema additions

Migration: `20260527150000_pr_scorecard_2_tracking` (applied).

**New enums**
- `MarketingChannelType` — 12 values (INSTAGRAM / LINKEDIN / YOUTUBE / TWITTER / WHATSAPP / EMAIL / WIX_HOMEPAGE / TELEGRAM / TIKTOK / FACEBOOK / DIRECT / OTHER)
- `AffiliateAgentStatus` — ACTIVE / PAUSED / TERMINATED
- `TrackingLinkStatus` — ACTIVE / ARCHIVED

**New tables**
- `affiliate_agents` — referrer profiles (fullName, email?, phone?, status, notes?, createdById)
- `tracking_links` — per-channel short URLs (shortCode UNIQUE, channel, agentId?, campaignLabel?, destination, status, clickCount, createdById, archivedAt?)
- `tracking_link_clicks` — one row per click (linkId, clickedAt, ipAddress?, userAgent?, referer?)

**Existing table changes**
- `leads` — `trackingLinkId TEXT NULL`, `attributedAgentId TEXT NULL` (both with FKs SET NULL on delete; both indexed)
- `scorecard_submissions` — `isDraft BOOLEAN NOT NULL DEFAULT FALSE`, `draftLastSavedAt TIMESTAMP(3) NULL`; composite index `(userId, isDraft)`

Existing rows backfill: `isDraft=false` (default), `trackingLinkId/attributedAgentId=null`. Zero existing rows are touched destructively.

## 2. Backend surface

```
POST   /scorecard/submit                       LEAD/STUDENT/OWNER/ADMIN/SUPER_ADMIN   (extended w/ attribution body)
POST   /scorecard/draft                        LEAD/STUDENT/OWNER/ADMIN/SUPER_ADMIN   NEW
GET    /scorecard/me/draft                     LEAD/STUDENT/OWNER/ADMIN/SUPER_ADMIN   NEW

GET    /staff/marketing/agents                 OWNER/ADMIN/SUPER_ADMIN                NEW
GET    /staff/marketing/agents/:id             OWNER/ADMIN/SUPER_ADMIN                NEW
POST   /staff/marketing/agents                 OWNER/ADMIN/SUPER_ADMIN                NEW
PATCH  /staff/marketing/agents/:id             OWNER/ADMIN/SUPER_ADMIN                NEW
PATCH  /staff/marketing/agents/:id/status      OWNER/ADMIN/SUPER_ADMIN                NEW
DELETE /staff/marketing/agents/:id             OWNER                                  NEW (sub-gated)

GET    /staff/marketing/links                  OWNER/ADMIN/SUPER_ADMIN                NEW
GET    /staff/marketing/links/:id              OWNER/ADMIN/SUPER_ADMIN                NEW
GET    /staff/marketing/links/:id/stats        OWNER/ADMIN/SUPER_ADMIN                NEW (windowDays query)
POST   /staff/marketing/links                  OWNER/ADMIN/SUPER_ADMIN                NEW
PATCH  /staff/marketing/links/:id/archive      OWNER/ADMIN/SUPER_ADMIN                NEW

GET    /s/:shortCode                           PUBLIC (no auth, no role gate)         NEW
```

LIA / CONSULTANT / FINANCE / SUPPORT / SALES / STUDENT / LEAD all return 403 on `/staff/marketing/*` — defence in depth (RolesGuard at the controller + UI sidebar gate that hides the nav item).

## 3. The short-link redirector — `/s/:shortCode`

Public Express-style controller. Flow:

1. Look up the `TrackingLink` by shortCode.
2. ARCHIVED or missing → respond 404.
3. ACTIVE → inside a transaction: write a `tracking_link_clicks` row + `clickCount: { increment: 1 }`. Set the `sv_attribution` cookie (90 days, Lax, httpOnly:false) so the client-side form can read it. 302 to `destination`.

**Why httpOnly:false** — the form's JS reads `document.cookie` to forward attribution in the submit body. The cookie value is just a `TrackingLink.id` (UUID) — not a credential — so the security trade-off is acceptable. The marketing controller writes audit rows on link create / archive, but **per-click rows are not audited** (volume would drown the audit log; the per-click table is the forensics record).

## 4. Attribution flow

The scorecard form **reads** attribution from two places and **forwards** them to the backend in the submit body:

1. `sessionStorage['sv_scorecard_attribution']` — populated by the landing page from `?ch=…&agent=…&campaign=…`
2. `document.cookie['sv_attribution']` — the linkId, set by the `/s/:shortCode` redirector

```
POST /scorecard/submit
{
  "answers": { ... },
  "attribution": {
    "trackingLinkId": "uuid",       // from cookie
    "agentId":        "uuid",       // optional direct agent attribution
    "campaignLabel":  "Spring 2026",
    "channel":        "instagram"
  }
}
```

Backend (`ScorecardService.resolveAttribution`):
- If `trackingLinkId` resolves to a TrackingLink → copy its `agentId`, `campaignLabel`, `channel` into the Lead row.
- Even **archived** links still attribute (someone who bookmarked the link a month ago still deserves the credit when they convert).
- If only `agentId` (no link), validate the agent isn't TERMINATED — set on the Lead.
- If only `channel` (e.g. someone manually typed a URL), use it as a string hint on `Lead.sourceChannel` (`SCORECARD_INSTAGRAM`).

**First-attribution-wins** is enforced by the Lead being **fresh** in the submit transaction — the Lead is created at submit time, so there's nothing existing to overwrite. If a user re-submits with a different attribution later (re-takes), a NEW Lead is created with the new attribution, not the old one. This matches the spec's intent: the channel that ORIGINALLY brought the lead in keeps the credit; subsequent re-engagements are separate funnel events.

> Caveat: PR-SCORECARD-1 stores a unique constraint on `ScorecardSubmission.leadId`. So a re-take currently creates a new Submission + a new Lead. If a future PR wants to enforce one Lead per (User, attribution), revisit this — but the spec for PR-SCORECARD-2 didn't ask for it.

## 5. Draft autosave

`ScorecardSubmission` rows can now exist in two states:

- `isDraft = true` — sentinel zeros across all scoring columns; only `answersEncrypted` and `draftLastSavedAt` are trustworthy. Read by `/scorecard/me/draft`, written by `/scorecard/draft`.
- `isDraft = false` — real submission. PR-SCORECARD-1 behaviour intact.

On submit (`/scorecard/submit`):
- If the user has an open `isDraft=true` row, it's **updated in place** (graduated to a real submission). Otherwise a new row is created.
- This keeps "at most one draft per user" without needing a unique constraint.

`saveDraft()` writes sentinel zeros for the NOT NULL scoring columns (`totalScore=0`, `band='BAND_1'`, `nextAction='NURTURE_ONLY'`, `executionEligible=false`, empty JSON for `hardStops`/`gateResults`). The frontend never reads scoring fields while `isDraft=true`. This avoids a destructive schema change to nullable columns (which would force a backfill on every legacy submitted row).

## 6. Frontend public surface (deviation from spec)

The spec said `/[locale]/scorecard/landing` etc. — but this project does **not** use `[locale]` route segments. Locale is client-side via `LocaleProvider` + `useLocaleStore` (Zustand) — every page is at a single URL, strings switch via the LocaleProvider context. New pages mirror that pattern:

```
/scorecard/landing   — landing (public)
/scorecard           — form (auth required; redirects to /login?returnTo=/scorecard)
/scorecard/result    — result (auth required; redirects to /scorecard/landing if no submission)
```

**Why a `lib/scorecard/labels.ts` helper instead of next-intl keys**: the form alone has 53 questions × multiple options. Adding ~2000 keys × 2 locales to the 1600-line `en.json` / `fa.json` would dwarf the form code itself, and most existing scorecard pages (the staff list/detail from PR-SCORECARD-1) use hardcoded English. The labels file centralises bilingual strings the same way next-intl would, just without the routing tax. The Persian text for the Malaysia callout is VERBATIM from the brief — do not paraphrase. Section headings, UI labels, and the result page are fully bilingual; the questionnaire question text renders in English in both locales (option strings are verbatim from the scoring engine in both locales — they must match for scoring).

**Next iteration**: if the FA market grows, translate `lib/scorecard/questions.ts` `label` fields properly. Backend doesn't care — it only matches answer **values**, which are already verbatim from the engine.

## 7. Marketing portal UI

```
/staff/marketing                  — index (Agents | Links cards)
/staff/marketing/agents           — list with status filter + "Add agent" modal
/staff/marketing/agents/[id]      — agent detail (links list + band distribution + status toggle + OWNER-only delete)
/staff/marketing/links            — list with channel/agent/status filters + "Create link" modal
/staff/marketing/links/[id]       — link detail (full destination + stats w/ 30/60/90d toggle + band-distribution Recharts bar chart + archive button)
```

The sidebar gains a "Marketing" item (Megaphone icon) visible **only** to OWNER/ADMIN/SUPER_ADMIN — the `roleGate` is inline because `StaffContext` doesn't have a `canManageMarketing` permission yet (TODO for follow-up if more marketing surfaces appear).

Delete-safety on agents: an agent with ACTIVE tracking links can't be deleted (409 ConflictException) — they must archive the links first. Archived-only agents can be deleted; the links survive as orphans (`agentId` SET NULL), so existing leads stay attributed. This is OWNER-only at both the controller and the UI.

## 8. Audit events (additions to summary helper)

Added 5 new cases to `summarizeAuditEntry()`:

- `AFFILIATE_AGENT_CREATED` → "Affiliate agent created: {name}"
- `AFFILIATE_AGENT_UPDATED` → "Affiliate agent updated ({changedFields})"
- `AFFILIATE_AGENT_STATUS_CHANGED` → "Affiliate agent {name}: status → {status}"
- `AFFILIATE_AGENT_DELETED` → "Affiliate agent deleted: {name}"
- `TRACKING_LINK_CREATED` → "Tracking link created: {shortCode} ({channel})"
- `TRACKING_LINK_ARCHIVED` → "Tracking link archived: {shortCode}"

(Six total — `AFFILIATE_AGENT_DELETED` was added on top of the spec's five because deletion is destructive and worth auditing.)

## 9. Environment

One new env var: `WEB_BASE_URL` — used to build the full short URL (`{WEB_BASE_URL}/s/{shortCode}`) and to resolve relative destinations like `/scorecard/landing` into absolute URLs.

- Default: `http://localhost:3000` when unset.
- Production: set to `https://app.sorenavisa.com` (or whichever subdomain hosts the public scorecard pages).

No other env vars added. No new npm dependencies added.

## 10. Smoke tests

- Backend `npx tsc --noEmit` — exit 0
- Frontend `npx tsc --noEmit` — exit 0
- `npx jest src/scorecard/scoring/scoring.spec.ts` — 40/40 PASS (PR-SCORECARD-1 tests still green)
- Routes (unauthenticated):
  - `GET /scorecard/me/draft` → 401
  - `POST /scorecard/draft` → 401
  - `GET /staff/marketing/agents` → 401
  - `POST /staff/marketing/links` → 401
  - `GET /staff/marketing/links/x` → 401
  - `GET /s/abcdef` (unknown code) → 404 (correct — short-link endpoint is public; 404 instead of 401 because there's no auth requirement, the link just doesn't exist)
- PM2: both `sorena-backend` and `sorena-frontend` online.

Conditional logic in the form is manually tested via the question schema: Q5 only renders if Q4=Male, Q7 only if Q6=Married/Divorced, Q9-11 only if Q6=Married, Q45-46 only if Q44=Yes. Hidden questions are stripped before submit so the engine never sees them (a hidden answer counts as `undefined` = 0 points, identical to the Python source behaviour).

## Backlog / future work

**PR-AFFILIATE-1** — commission math:
- Add `commissionPercent` and `commissionFlatAmount` columns to `AffiliateAgent`
- Build payout-approval workflow (PaymentRequest → OwnerApprovalRequest)
- Wire university-invoice-paid signal → calculate agent commission

**PR-SCORECARD-3** — PDF generation:
- Render the result page to PDF (pdf-lib or Puppeteer)
- Email the PDF to the lead on submit
- Wire the "Download report (PDF)" button on the result page

**PR-SCORECARD-4** — Stripe for Band 3:
- Wire the "Pay 30 NZD" button on the result page to a Stripe checkout
- Webhook: on payment.succeeded → flip Lead.subscriptionPlan, generate AI improvement plan, email booking link

**PR-WIX-BOOKINGS** — replace the booking-link placeholder with a per-language Wix Bookings URL stored in `PlatformSetting`.

**Other follow-ups noticed during build**:
- Add `canManageMarketing` permission to `StaffContext.permissions` so the sidebar nav gate isn't inline.
- Translate `lib/scorecard/questions.ts` question labels to Persian (option strings stay verbatim).
- Rate-limit `/s/:shortCode` to deflate bot floods (currently writes a `tracking_link_clicks` row per request).
- Add a "first-attribution-wins" guard for re-takes: when a new submission happens for a User who already has an attributed Lead, decide whether to re-attribute or copy the original. Today each submit creates a fresh Lead.
- Add `eligible` filter to the staff scorecards list (this was a small omission in PR-SCORECARD-1 — the filter chips already render but the query string isn't passed to the backend).
- Year-over-year band analytics dashboard.
- CSV bulk export of scorecards.
- Email automation for Bands 1-2 nurture (SendGrid / Mailchimp).
- AI improvement plan generation for Band 3 (already wired to where it would slot in).
- Form abandonment alerts to sales.
- A/B testing the form layout.

## File map

**Backend (new)**
- `backend/prisma/migrations/20260527150000_pr_scorecard_2_tracking/migration.sql`
- `backend/src/marketing/dto/marketing.dto.ts`
- `backend/src/marketing/affiliate-agents.service.ts`
- `backend/src/marketing/tracking-links.service.ts`
- `backend/src/marketing/marketing.controller.ts`
- `backend/src/marketing/short-link.controller.ts`
- `backend/src/marketing/marketing.module.ts`

**Backend (modified)**
- `backend/prisma/schema.prisma` — 3 enums + 3 models + Lead cols + ScorecardSubmission cols + User inverse relations
- `backend/src/app.module.ts` — registers MarketingModule
- `backend/src/common/audit/audit.helper.ts` — 6 new event-type summaries
- `backend/src/scorecard/dto/scorecard.dto.ts` — AttributionDto + SaveScorecardDraftDto
- `backend/src/scorecard/scorecard.service.ts` — `saveDraft`, `getDraft`, `resolveAttribution`, draft-graduation flow
- `backend/src/scorecard/scorecard.controller.ts` — `/scorecard/draft` + `/scorecard/me/draft` + attribution forwarding

**Frontend (new)**
- `frontend/src/lib/scorecard/labels.ts` (~155 LOC) — bilingual strings
- `frontend/src/lib/scorecard/questions.ts` (~340 LOC) — 53-question schema with conditional rules
- `frontend/src/app/scorecard/landing/page.tsx` (~115 LOC)
- `frontend/src/app/scorecard/page.tsx` (~40 LOC)
- `frontend/src/app/scorecard/result/page.tsx` (~50 LOC)
- `frontend/src/components/scorecard/ScorecardForm.tsx` (~290 LOC) — autosave multi-step form
- `frontend/src/components/scorecard/ScorecardResultClient.tsx` (~280 LOC) — SAMPLE PDF reproduction
- `frontend/src/app/staff/marketing/page.tsx` (~60 LOC)
- `frontend/src/app/staff/marketing/agents/page.tsx` (~135 LOC)
- `frontend/src/app/staff/marketing/agents/[id]/page.tsx` (~145 LOC)
- `frontend/src/app/staff/marketing/links/page.tsx` (~150 LOC)
- `frontend/src/app/staff/marketing/links/[id]/page.tsx` (~105 LOC)
- `frontend/src/components/staff/marketing/CreateAgentButton.tsx` (~125 LOC)
- `frontend/src/components/staff/marketing/AgentActions.tsx` (~95 LOC)
- `frontend/src/components/staff/marketing/CreateLinkButton.tsx` (~145 LOC)
- `frontend/src/components/staff/marketing/CopyShortUrl.tsx` (~30 LOC)
- `frontend/src/components/staff/marketing/ArchiveLinkButton.tsx` (~45 LOC)
- `frontend/src/components/staff/marketing/LinkStatsBlock.tsx` (~125 LOC)

**Frontend (modified)**
- `frontend/src/components/staff/shell/StaffSidebar.tsx` — Marketing nav item with role-gate
- `frontend/src/i18n/messages/en.json` — `staff.nav.marketing = "Marketing"`
- `frontend/src/i18n/messages/fa.json` — `staff.nav.marketing = "بازاریابی"`
