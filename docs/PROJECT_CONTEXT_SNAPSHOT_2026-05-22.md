# Sorena Visa Platform — Context snapshot, 2026-05-22

Resume-anywhere doc. Drop this (plus the master prompt + latest handover) into any new chat and the assistant has enough to continue without re-explaining the project.

## 1. Who is the user

**Arjmand** — owner / founder of **Sorena Visa** (sorenavisa.com). New Zealand–based education + immigration consultancy serving Iranian and other Persian-speaking applicants. **Zero coding background.** Builds the entire platform via Claude Code inside VS Code. Speaks English + Persian; localised UI is non-negotiable.

Mode of work: ships one PR per session, drives via a structured "master prompt" pattern + per-PR specs. Expects autonomous end-to-end execution per PR (build, type-check, commit, push), with a handover doc accompanying every feature so context survives across sessions.

## 2. Shipped PRs — chronological

(Pulled from `git log` on `main`. Older infra commits before the security foundations are omitted.)

### Security foundations
- `8312504` — feat(crypto): add CryptoService with AES-256-GCM (PR-SEC1)
- `c506fb1` — feat(email-hash): add EmailHashService HMAC-SHA256 (PR-SEC2a)
- `b799073` — feat(email-hash): emailHash schema + migration + wiring (PR-SEC2b)
- `a2f8d61` — feat(crypto): encrypt 16 PII fields on AdmissionApplication (PR-SEC3)

### Admission flow (Steps 1–8)
- `380a1a7` — fix(uploads): sweep stale pending uploads at startup
- `c48a134` — feat(admission): Step 2 form complete + Step 1 welcome + i18n polish
- `665f76d` — feat(admission): Step 3 Education & English (3 Qs)
- `ddbaf31` — feat(admission/step3): qualification dropdown + transcripts helper
- `d3b6a28` — feat(admission/step3): funding dropdown + qualification label fix
- `d2760bd` — feat(admission/step3): Health Information subsection + dividers
- `73155ac` — feat(admission): build Steps 5–8 (Guardian, Accommodation, Agent, Acceptance)
- `dbcb624` — feat(admission): Education History repeating table + per-row docs (PR-EDU1)
- `55b74a0` — feat(admission): DOB + marital status + children on Step 2 (PR-A)
- `b7f9620` — feat(admission): skip Guardian + Accommodation for 18+ (PR-B)
- `1c5902a` — feat(admission): education entry improvements (PR-C1)
- `4fbfdd9` — feat(admission): year + progression validation, submit-gate, BTT (PR-C2)

### Visa section (INZ form, 14 PRs)
- `708690c` — VISA-PR-1: Visa Section + INZ Identity Details
- `1b47a43` — VISA-PR-2: INZ Address & contact + photo block
- `d1b9d6d` — VISA-PR-3: INZ Eligibility section
- `6733009` — VISA-PR-4: INZ Character section
- `f6c148a` — VISA-PR-5: INZ Health section + login fix
- `8d52c86` — VISA-PR-6: INZ Education history section
- `15430d9` — VISA-PR-7: INZ Employment history section
- `33198d8` — VISA-PR-8: INZ Relationships section
- `ce242f5` — VISA-PR-9: Background details (10 Y/N questions)
- `97a5154` — VISA-PR-10: Military history (Step 10)
- `30085f9` — VISA-PR-11: Travel history
- `6fa4685` — VISA-PR-12: Immigration assistance
- `ab255be` — VISA-PR-13: Supporting documents (metadata only)
- `6d9267c` — VISA-PR-14: Supporting documents (2) (metadata only)
- `de550ce` — Remove public eligibility wizard — Wix handles lead capture
- `b8d774e` — docs(visa): Visa Section handover (master + 14 PR appendices)

### Student dashboard (PR-DASH-1..4)
- `96501e6` — feat(dashboard): PR-DASH-1 client dashboard shell + AI report card + case + documents + activity
- `e7cf818` — feat(dashboard): PR-DASH-2 Support tickets + VisaCaseFileNote
- `c2257bc` — feat(meetings): PR-DASH-3 meetings + transcripts (student + consultant)
- `a8dccb4` — docs(meetings): PR-DASH-3 handover
- `1a67115` — feat(chatbot): PR-DASH-4 student AI chatbot, Pattern 1 escalation
- `83c52e7` — docs(chatbot): PR-DASH-4 handover

### Staff portal (PR-CONSULT-1..4)
- `afb00ea` — feat(staff): PR-CONSULT-1 staff roles, load-based auto-allocation, owner-approval queue
- `ee5d4ce` — docs(staff): PR-CONSULT-1 handover
- `0964b08` — feat(staff): PR-CONSULT-2 staff dashboard shell, cases list and detail
- `706a4eb` — docs(staff): PR-CONSULT-2 handover
- `98835a4` — fix(i18n): resolve staff namespace keys in frontend
- `832805a` — feat(staff): PR-CONSULT-3 staff users and approvals UI
- `476ea3c` — docs(staff): PR-CONSULT-3 handover
- `808c77e` — feat(staff): PR-CONSULT-4 staff profile fields, edit, archive, hard delete, SALES cleanup
- `0616601` — docs(staff): PR-CONSULT-4 handover

### Wix integration (PR-WIX-1)
- `cd245bb` — feat(wix): PR-WIX-1 lead capture webhook
- `cb86009` — docs(wix): PR-WIX-1 handover
- `ba2bfee` — fix(wix): PR-WIX-1 return 200 on success and preserve INVALID_SECRET body

## 3. Tech stack (locked)

| Layer | Choice |
|---|---|
| Frontend | Next.js 14+ App Router |
| Backend | NestJS |
| ORM / DB | Prisma + Postgres (local dev DB: `sorenavisaplatform` on `localhost:5432`) |
| Styling | Tailwind CSS |
| Components | shadcn/ui (partial — used for buttons, cards, inputs). Custom inline overlay modals (no `Dialog` primitive). |
| i18n | `next-intl` v4 — nested JSON only; flat dot-keys do **not** resolve |
| Forms | `react-hook-form` + `zod` |
| Auth | Cookie-bound JWT, email/password — **NOT** Google OAuth |
| Encryption at rest | AES-256-GCM via `CryptoService` (PR-SEC1) — base64 envelope in TEXT columns |
| Email-hash | HMAC-SHA256 via `EmailHashService` (PR-SEC2a/b) |
| Country data | `i18n-iso-countries` (added in PR-CONSULT-4) — both `en` + `fa` locales registered |
| AI chatbot | Anthropic SDK (`@anthropic-ai/sdk`), model `claude-haiku-4-5-20251001` (PR-DASH-4) |
| Frontend hosting | Vercel (planned; not yet deployed) |
| Backend hosting | Not yet deployed publicly. Local dev + ngrok tunnel for Wix testing. |

## 4. Staff roles (locked)

8 enum values on `UserRole`:

| Role | Notes |
|---|---|
| `STUDENT` | Platform end-user. No staff access. |
| `OWNER` | Sole role that can approve owner-approval queue items. Inline-executes everything. **Only one OWNER expected.** UI hides OWNER from every role dropdown — promotion / demotion via direct SQL only. |
| `SUPER_ADMIN` | Same powers as OWNER but destructive actions are queued for OWNER approval. |
| `ADMIN` | Read-all + manage cases + manage staff (read-only). Cannot enqueue or approve destructive actions. |
| `LIA` | Licensed Immigration Adviser. Sees only own case assignments. |
| `CONSULTANT` | Sees only own assignments. |
| `SUPPORT` | Sees only own assignments. |
| `FINANCE` | Sees only own assignments. |

`SALES` retained as **deprecated** enum value (PR-CONSULT-4) — Postgres can't `DROP VALUE`. DTO layer rejects new writes to it; any existing SALES users were re-stamped to CONSULTANT + archived.

Full role × action matrix lives in `docs/PHASE_CONSULT_1_STAFF_ROLES_AND_ALLOCATION.md`.

## 5. Current staff users (live, from DB at 2026-05-22)

| Role | Name | Email | Active |
|---|---|---|---|
| OWNER | Arjmand | arjmand@sorenavisa.com | ✅ |
| ADMIN | Iydin Tashvighi | iydin@sorenavisa.com | ✅ |
| LIA | Sheila Rose | sheilarose@sorenavisa.com | ✅ |
| CONSULTANT | Test Sales *(legacy, ex-SALES)* | sales@sorenatest.com | ❌ archived |
| SUPPORT | Elisa Modiri | elisa@sorenavisa.com | ✅ |
| SUPPORT | Test Support | support@sorenatest.com | ❌ archived |
| FINANCE | Arjmand Finance *(owner's separate finance account)* | finance@sorenavisa.com | ✅ |
| SUPER_ADMIN | Test Admin | admin@sorenatest.com | ❌ archived |

5 active staff (1 OWNER + 1 ADMIN + 1 LIA + 1 SUPPORT + 1 FINANCE) + 3 archived test users. No active SUPER_ADMIN — Arjmand operates as OWNER directly.

## 6. Owner-approval queue — 8 action types

Defined as `OwnerApprovalActionType` enum. SUPER_ADMIN initiating any of these enqueues a `PENDING` `OwnerApprovalRequest`; OWNER `/staff/approvals` page approves → executor runs inline → row moves to `EXECUTED` / `EXECUTION_FAILED`.

1. `CREATE_STAFF_USER` — invite a new staff member.
2. `CHANGE_STAFF_ROLE` — change someone's role.
3. `DEACTIVATE_STAFF` — archive a staff user (close assignments + reallocate).
4. `DELETE_CASE` — hard-delete a VisaCase.
5. `DELETE_STUDENT` — hard-delete a Student User row.
6. `ISSUE_REFUND` — create a Refund row (Stripe not wired yet).
7. `CHANGE_PLATFORM_SETTING` — write to encrypted PlatformSetting.
8. `HARD_DELETE_STAFF` — permanently remove a staff User row (PR-CONSULT-4). Snapshots audit attribution + cleans up NO ACTION FKs before delete.

ADMIN cannot enqueue any of these. OWNER inline-executes via the same executor dispatch, so audit lines stay consistent.

## 7. Locked conventions

- **Locale-flat routes.** No `[locale]` URL segment — locale is a client-side store (`useLocaleStore`). All routes are paths like `/student/dashboard`, `/staff/cases/[id]`. Frontend swaps message bundles in `LocaleProvider`.
- **`Visa*` model prefix.** Every visa-domain Prisma model is prefixed `Visa…` (`VisaApplication`, `VisaCase`, `VisaCaseAssignment`, `VisaSupportTicket`, `VisaMeeting`, `VisaChatConversation`, etc.). Reserves the namespace as new modules land.
- **Metadata-only file pattern.** Document uploads store metadata rows (filename, mime, size, uploaderId, encryptedBlobRef) in Postgres; binary blobs live elsewhere (S3-compatible storage planned; local-disk in dev). No binary blob ever sits in a Postgres column.
- **DB-count rate limits.** All sensitive endpoints have a per-actor rate limit implemented as a Prisma `auditLog.count(WHERE userId AND eventType AND createdAt > since)` guard. Avoids needing Redis. Defaults: read endpoints rely on the global `@nestjs/throttler` 60/min; writes get explicit per-route counts.
- **Inline overlay modals.** Every modal in the project is a hand-rolled `fixed inset-0` div with a backdrop + a centred panel. No shadcn `Dialog` primitive — was rejected early.
- **AES-256-GCM via CryptoService.** Every encrypted column stores `base64(version || iv || tag || ciphertext)` in a TEXT column. 29-byte header. Key rotation via `ENCRYPTION_KEY_VERSION`.
- **Audit log on every mutation.** `audit_logs` table receives a row per write. Schema: `userId?`, `action`, `eventType?`, `entityType?`, `entityId?`, `oldValue Json?`, `newValue Json?`, `actorNameSnapshot?`, `actorRoleSnapshot?` (snapshots from PR-CONSULT-4). The summariser in `common/audit/audit.helper.ts` renders one-line activity-feed strings per `eventType`.
- **One commit per PR (feature) + one commit per PR (handover doc).** Conventional commits (`feat(scope):`, `docs(scope):`, `fix(scope):`). Push to `main` after both commits land.
- **Hand-written Prisma migrations.** Never `prisma migrate dev --name …`. Always craft the SQL by hand under `prisma/migrations/<UTC>_…/migration.sql` and apply via `prisma migrate deploy`. Keeps data migrations + idempotent guards + comments under our control.
- **Frontend type-check before commit.** `cd frontend && npx tsc --noEmit` exits clean. Same for backend.
- **No smoke tests during build PRs.** Spec explicitly says "do NOT run smoke tests" — type-check is the verification bar. Manual test plan lives in the handover doc.

## 8. UI rules (locked)

- **Palette:** Navy `#1e3a5f` primary, gold `#c9a961` accent, off-white `#faf8f3` background.
- **Buttons:** ≥48px touch target (`min-h-[48px]`), 12px radius (`rounded-xl`).
- **Cards / overlays:** 16px radius (`rounded-2xl`).
- **Mobile-first.** Every page works without a sidebar; sidebars collapse below `lg:`.
- **RTL for `fa` locale.** `LocaleProvider` flips `<html dir="rtl">` when active.
- **One primary action per screen.** Navy filled button. Secondary actions are outlined.
- **Inline overlay modals only.** Never the shadcn `Dialog`. Click-outside to close (unless mid-submit). Backdrop `bg-black/40`.
- **Role badges** color-coded (PR-CONSULT-2): OWNER gold/navy, SUPER_ADMIN navy/off-white, ADMIN slate-700/white, LIA/CONSULTANT/SUPPORT/FINANCE gray-100/gray-800.
- **i18n keys are nested.** `next-intl` v4 splits on `.` and walks objects; flat keys with literal dots don't resolve.

## 9. Wix integration state

- **PR-WIX-1 shipped** (commits `cd245bb`, `cb86009`, `ba2bfee`). Webhook at `POST /api/webhooks/wix/lead-capture`.
  - Shared-secret auth (`x-sorena-webhook-secret` header, env var `WIX_WEBHOOK_SECRET`).
  - Idempotent on `sha256(email + '|' + submittedAt + '|' + secret).slice(0, 32)` stored as `Lead.externalSubmissionId @unique`.
  - Fuzzy payload normaliser handles canonical envelope, flat fields, `submissions: [{name, value}, …]`, mixed casing.
  - Country resolution: alpha-2 → validate, else name → alpha-2 via `i18n-iso-countries`, else `Lead.countryRaw`.
  - `@HttpCode(200)` + route-scoped `WixWebhookExceptionFilter` so success returns 200 and error bodies preserve `{ status, error, message }` shape.
- **Smoke test: 7/7 strict pass** via ngrok against the local backend (canonical, dedupe, flat, label-style, country fallback, missing email → 400, wrong secret → 401). Confirmed leads land + linked Contacts get country resolution.
- **Wix side NOT configured yet.** No Wix form is currently pointing at the webhook.
- **Discovery (open):** The Wix property at `https://sorenastudy.wixstudio.com/scorecard` is a **3-minute Sorena Readiness Assessment scorecard**, NOT a simple lead form. The scorecard evaluates 5 areas:
  1. Academic Foundation
  2. Financial Readiness
  3. English & Study
  4. Goals & Intent
  5. Travel & Visa History
- **Scope of what to pull from Wix is still under discussion.** Two options on the table:
  1. **Contact fields only** — name, email, phone, country, education level. Scorecard answers stay on Wix.
  2. **Contact + all 5 scorecard answer sets + calculated score** — full data parity, lets the platform replay the scoring on its own engine.
  - User has agreed to send screenshots of the actual Wix form pages so the next session can lock the scope.

## 10. Test credentials

- **OWNER login** — `arjmand@sorenavisa.com` / `SorenaOwner2026!`
- **Test student login** — `test@sorenatest.com` / `SorenaTest2026` *(archived in PR-CONSULT-4, but still usable for login attempts; UI rejects deactivated accounts from staff routes — student route check needs verification if this account is being used for testing)*
- **ngrok URL** — `https://exodus-celibacy-cupbearer.ngrok-free.dev` *(forwards to `localhost:3001`; will change when the ngrok tunnel restarts)*

**Never echo `WIX_WEBHOOK_SECRET` value in any output.** It lives in `backend/.env`. Load with `grep '^WIX_WEBHOOK_SECRET=' backend/.env | sed -E 's/^[^=]+=//; s/^"//; s/"$//'` into a shell var; use only in HTTP headers; never log.

## 11. Currently running services (local)

| Service | Port | Status |
|---|---|---|
| Backend (`nest start --watch`) | `3001` | Running, hot-reloads on save |
| Frontend (`next dev`) | `3000` | Running |
| Postgres | `5432` | `sorenavisaplatform` DB; password in `backend/.env` |
| ngrok | tunnels `:3001` → `https://exodus-celibacy-cupbearer.ngrok-free.dev` | Free-tier; URL changes on restart |

Env files: `backend/.env` (gitignored) + `frontend/.env.local` (gitignored). `backend/.env.example` is the canonical reference.

**Quirk:** Windows holds the Prisma query-engine DLL open via the dev server. `npx prisma generate` after a schema change requires stopping `nest start --watch` (or `Get-Process node | Stop-Process -Force` in PowerShell) before it can rename the temp DLL.

## 12. Open work / next decisions

- **Wix scorecard scope.** Pick option (a) contact-only vs (b) full scorecard + score. User to send screenshots; lock scope; either expand `Lead.webhookMetadata` JSON or add structured scorecard tables to schema.
- **Wix-side webhook configuration.** Wait for scope decision. Then either:
  - **Wix Automations** route (no-code, posts on form submit), or
  - **Velo (Wix code)** route (more control, can post calculated score + per-question answers).
- **Production backend deployment.** Not yet deployed publicly. ngrok is local-dev-only and the URL is not stable. Need a Vercel / Railway / Fly.io decision plus production `WIX_WEBHOOK_SECRET` rotation + Wix-side URL update.
- **Custom domain.** `www.sorenavisa.com` not yet pointed at the platform. Wix currently owns the apex domain.
- **Email service wiring.** Staff create flow surfaces `tempPassword` in the response (TempPasswordModal) because no email service is wired yet. PR-CONSULT-3 handover documents the email-pipeline follow-up.
- **Stripe.** `ISSUE_REFUND` writes a placeholder `Refund` row with `status='PENDING_STRIPE_INTEGRATION'`. Real Stripe integration is a future PR.
- **Existing audit-write paths** (~14 sites across assignments/owner-approval/admission/chatbot/dashboard/meetings/tickets) don't yet populate `actorNameSnapshot`/`actorRoleSnapshot` at write-time. PR-CONSULT-4's delete-time UPDATE covers them when an actor is hard-deleted; can be migrated incrementally.
- **Leads UI.** Wix-captured leads exist in the DB but no `/staff/leads` page yet. Visible only via SQL or by calling `GET /leads`.

## 13. Phased roadmap snapshot

The master prompt outlined phases by domain (1–10). The real build order has deviated — we ship by user-facing slice (`VISA-PR-*`, `PR-DASH-*`, `PR-CONSULT-*`, `PR-WIX-*`) rather than by domain phase. Map between the two:

| Master-prompt phase | Slice that landed | Status |
|---|---|---|
| Phase 0: security foundations | PR-SEC1, SEC2a, SEC2b, SEC3 | ✅ done |
| Phase 1: admission funnel | Admission flow PRs (Steps 1–8) + EDU repeating tables | ✅ done |
| Phase 2: visa application form | VISA-PR-1..14 (INZ student-visa form, 14 sub-sections) | ✅ done — metadata-only docs |
| Phase 3: client dashboard | PR-DASH-1..4 | ✅ done |
| Phase 4: staff portal | PR-CONSULT-1..4 | ✅ done |
| Phase 5: external integrations | PR-WIX-1 | 🟡 partial — backend ready, Wix-side not configured |
| Phase 6: payments | docs/PHASE_6_PAYMENTS.md scoped, code unstarted | ⬜ |
| Phase 7: AI scoring + recommendations | Scoring engine wired into PublicService; chatbot live; assessment-report writeback target exists. Friday-bot pipe to PR-DASH-1's AssessmentReportCard is unwired. | 🟡 partial |
| Phase 8: notifications | NotificationsService stub + welcome-email path in PublicService; no Slack / SMS / WhatsApp providers wired | 🟡 partial |
| Phase 9: ops + reporting | None | ⬜ |
| Phase 10: hardening + deploy | Not started | ⬜ |

**Immediate next slice** (per current direction): PR-WIX-2 — Wix scorecard ingestion (once scope is locked) or a leads-list page under `/staff/leads`.

## 14. Files to re-paste into any new chat to restore context

Drop these three into a fresh chat and the assistant has full project context without re-explaining anything:

1. **This snapshot** — `docs/PROJECT_CONTEXT_SNAPSHOT_2026-05-22.md` (the file you're reading).
2. **The master prompt** the user keeps in their notes — *"PROJECT: Sorena Executive Advisory Council — CRM & Business Platform"*. The lock list (roles, conventions, UI rules) in that prompt is the source-of-truth for everything in sections 4, 7, 8 of this doc.
3. **The latest handover doc** from the most recently shipped PR:
   - As of 2026-05-22 → `docs/PHASE_WIX_1_LEAD_CAPTURE.md`
   - When a newer PR ships, swap to that one.

For deeper dives, also useful (one-off):
- `docs/PHASE_CONSULT_1_STAFF_ROLES_AND_ALLOCATION.md` — full role × action matrix.
- `docs/PHASE_CONSULT_4_STAFF_PROFILE_AND_LIFECYCLE.md` — encryption envelope details + audit-snapshot mechanism.
- `docs/VISA_SECTION_HANDOVER.md` — INZ form structure (14 sub-sections).
- `docs/PHASE_DASH_4_CHATBOT.md` — Anthropic SDK integration + Pattern 1 escalation contract.
