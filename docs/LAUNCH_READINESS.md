# Launch Readiness — Client Revenue Path

**Scope:** the CLIENT-facing revenue path only (prospective client → paying client →
active case). Internal staff/back-office tooling is out of scope. This is an honest,
evidence-based assessment from a read-only audit of the current code. **No code was
changed to produce it.**

**TL;DR:** The individual *tools* (Stripe, DocuSign, R2 uploads, the visa form,
messaging, wallet) are genuinely built and real. What's missing is the **connective
tissue that moves a paying client from "paid" to "active case with a signed
contract"** — that path currently requires manual API calls and has no UI — plus
**real production credentials, a CORS fix for the launch domain, a payment-receipts
page, and Persian/deploy polish**. You can launch in a **staff-assisted** mode after
the client-blockers below; it is **not yet true self-serve**.

---

## 1. Can a client go end-to-end?

| Step | Status | Reality |
|---|---|---|
| **Assess** (scorecard + PDF) | ✅ Works | Real submit → scored result → PDF. **Login-required** — the form redirects 401→`/login`; there is no anonymous/public scoring. |
| **Book** (free-15 + paid gap/LIA) | ✅ Works | Real slot → hold/confirm flow (`portal/booking`, backend `booking` module). Shows "no open times" until staff configure adviser availability. |
| **Pay** (Stripe) | ✅ Works (needs keys) | Real Stripe Checkout + HMAC-verified webhook (`payments/stripe.service.ts`, webhook in `payments.controller.ts`). Genuinely self-serve. Disabled if `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` unset. |
| **Get a case** | ⛔ **Staff-manual only** | No auto-creation from assessment or payment. A `Case` is created only when internal staff click "Create case" on the lead page (`app/staff/leads/[id]` → `POST /cases`). A client cannot trigger this. Gate also requires `lead.executionAllowed && !hardStopFlag`. |
| **Sign contract** (DocuSign) | ⛔ **No send trigger in the app at all** | The DocuSign integration is fully real (envelope create, CLIENT→LIA→DIRECTOR signers, HMAC-verified webhook, status sync). **But nothing in the frontend calls `POST /contracts`** — no client button, no staff button (confirmed by grepping all of `frontend/src`). The engagement letter can currently only be sent by a hand API call. Once sent, the client genuinely receives + signs via DocuSign email. |
| **Reach Stage 2** | ✅ Logic real / ⛔ unreachable | `GET /portal/me/stage` correctly derives STAGE_2 from CLIENT/GUARDIAN + LIA `signedAt` (director ignored); LEAD→STUDENT promotion fires from the DocuSign webhook. All correct — but it can never fire because contract-send (above) has no path. |
| **Upload docs** | ⚠️ Built, config-blocked | Full R2 3-step flow is coded (`CaseDocumentsPanel` + `documents` module + `r2.service`). **Placeholder R2 credentials** make the browser PUT fail locally; there is **no code gap** — works in prod with real R2 keys. |
| **Fill visa form** | ✅ Works | All ~14 steps are real components and all are wired (`VisaFormShell` Step1–Step14). Save/load real (full snapshot GET + create-on-mount POST). *Note: a stale header comment says "only one section built" — the code contradicts it.* Visa file uploads use local disk, independent of the R2 issue. |
| **Message adviser** | ✅ Works | Two-way case messages (`student/case/messages` + `case-messages` module) and support tickets (`student/tickets`, encrypted + audited) are both real. |

**Headline:** **Assess → Book → Pay are genuinely self-serve and functional (given env
config). Get-a-case and Sign-contract are the two hard breaks — both require internal
action, and contract-send has no UI anywhere — so a client cannot complete the funnel
end-to-end without staff intervention.**

**Nuance:** if the intended model is *staff-assisted* onboarding (client pays, then
your team vets + onboards), the manual case step is acceptable by design. But
**"no way to send the engagement letter from the product" is a real gap even for your
own staff** — someone must build that trigger or no contract ever goes out through the
app.

---

## 2. Is /student/payments a stub? Can a client see receipts/history?

**Still a stub.** `app/student/payments/page.tsx` renders a "Coming soon / under
construction" card (it only fetches `/students/me` for the name). A client has **no
receipts view, no invoice history, and no per-payment / Stripe-receipt detail
anywhere**.

- The only payment signal a client sees is an aggregate **"outstanding balance /
  all paid up"** tile on the dashboard (`app/student/page.tsx`), which links *into*
  the dead stub.
- A real client-facing endpoint exists (`GET /students/me/invoices`) but is only used
  for that one summary tile; the per-invoice payment breakdown was **deliberately
  removed** from the API "until the receipts page ships."
- The **wallet** (`/portal/wallet`) is real and works — balance + ledger — but that is
  store **credit**, not payment receipts.

**Net:** clients can pay, but cannot see proof of what they paid.

---

## 3. Are the client portal strings actually in Persian?

**Partial.** The admission and visa **forms** are genuinely translated; the portal
**shell** and several key screens are not.

- **Real Persian:** the large `admission*` and `visa*` blocks, and `portal.case.*`
  (stage labels, team, INZ ref, no-case, load-error).
- **Still English, with explicit `"_TODO"` markers in fa.json:**
  - `portal.nav.*` — the **entire portal sidebar** (My Case, Documents, Wallet,
    Messages, Home, Visa, Apply, Payments).
  - `portal.relogin.*`, `portal.contractReady.*`, `portal.assessment.*`,
    `portal.stage2.*` (the active-case task cards).
- **Blank in Persian (~38 keys render as empty string):** including the **application-
  submitted confirmation screen**, the **programme-picker first step**, the **file-
  upload widget labels**, and the admission stage stepper.
- **Two switcher bugs:** the language toggle exists (Globe button in `ClientShell`),
  but the choice **does not persist** (Zustand store with no cookie/localStorage →
  resets to English on every reload), and **server-rendered pages always render in
  English** (the `NEXT_LOCALE` cookie is never written). Default locale is `en`.

**Net:** a Persian client gets a half-English portal, a blank "application submitted"
screen, and a language preference that doesn't survive a refresh.

---

## 4. Localhost-only, or deploy-ready? Going live on www.sorenavisa.com

**Provisioned for Railway — not hardcoded to localhost — but with gaps, and one
domain mismatch that must be fixed for `www.sorenavisa.com`.**

- **⚠️ CORS does not allow `www.sorenavisa.com`.** The hardcoded allowlist in
  `backend/src/main.ts` contains `https://app.sorenavisa.com` (a **different host**),
  `https://ample-dream-production-1005.up.railway.app`, and localhost. Launching on
  `www.sorenavisa.com` requires **adding that exact origin** (via the `ALLOWED_ORIGINS`
  env var, or updating the list) — otherwise **every browser API call is blocked by
  CORS**. (CORS reads an `ALLOWED_ORIGINS` env list and supports `*`, so this is an
  env change, not necessarily a code change.)
- **Deploy config that exists:** `railway.json` (backend + frontend),
  `backend/Dockerfile` (multi-stage node:22-alpine, `prisma generate`),
  `backend/start.sh` (`prisma migrate deploy` → `node dist/main.js`),
  `backend/Procfile`, `helmet()` + `trust proxy 1` (Railway edge), listens on
  `0.0.0.0`. Stripe/DocuSign/mail/OAuth callback URLs derive from env
  (`FRONTEND_URL` / `APP_URL` / `BACKEND_URL` / `GOOGLE_CALLBACK_URL`), not hardcoded.
- **Deploy config that's missing:** no frontend Dockerfile (relies on Railway/
  Nixpacks), no CI/CD (`.github/workflows` is empty), no docker-compose / vercel /
  render / nginx.
- **Env examples are materially incomplete.** `backend/.env.example` omits many vars
  the code **hard-requires** to boot or function: `JWT_SECRET`, Stripe keys, the full
  DocuSign set, **all R2 vars** (`r2.service` throws on startup if unset), `RESEND_API_KEY`,
  Google OAuth, WhatsApp, and `APP_URL`/`BACKEND_URL`. An operator following the
  example alone would hit runtime crashes.
- **Frontend must be pointed at prod** via `NEXT_PUBLIC_BACKEND_URL` /
  `NEXT_PUBLIC_API_URL` (examples only carry the localhost dev value).
- **TLS/domain** is delegated to the Railway edge; nothing in-repo.

**To go live on www.sorenavisa.com you need:** add that origin to CORS; set the full
set of real secrets (DB, JWT, Stripe, DocuSign + engagement-letter PDF asset, R2,
Resend, encryption keys); point the frontend at the prod backend URL; and ship the
frontend build on the host.

---

## 5. What would break or confuse a real paying client on day one

- **They pay, then hit a dead end** — no case and no contract email arrive (both are
  manual / unbuilt), so they wait with no next step and no explanation.
- **Document upload fails** with a "Failed to fetch" error (placeholder R2) until real
  R2 credentials are set.
- **The "Payments" menu opens a "Coming soon" page** — no receipt for the money they
  just paid (a trust-killer right after payment).
- **Persian users** see a half-English portal, a blank "application submitted" screen,
  and a language that resets to English on refresh.
- **If launched on www.sorenavisa.com without the CORS origin added**, the site cannot
  talk to its own API at all — nothing loads.

---

## TRULY BLOCKS LAUNCH (client-facing)

1. **Add `www.sorenavisa.com` to the CORS allowlist** — otherwise the site can't reach
   its API (nothing works).
2. **Build the contract-send trigger** (at minimum a staff button that calls
   `POST /contracts`) — otherwise no client is ever onboarded through the product, and
   Stage 2 can never unlock.
3. **Wire / decide case creation** — either a clear staff path (case → contract in one
   place) or auto-create the case on payment; today the whole back half of the funnel
   hangs off a manually created Case.
4. **Set real production credentials** — Stripe, DocuSign (+ the engagement-letter PDF
   asset), **R2** (uploads fail and R2 throws on boot without it), Resend, encryption
   keys — and **fix `backend/.env.example`** so the deploy doesn't crash.
5. **Point the frontend at the prod backend** (`NEXT_PUBLIC_BACKEND_URL`).
6. **Ship a payment receipt/history view** — replace the `/student/payments` "Coming
   soon" stub so a paying client can see proof of payment.
7. **Add a post-payment "what happens next" status** so a paid client isn't stranded
   at a dead end.

## NICE TO HAVE / can wait

- Finish **Persian** for the portal shell (`portal.nav.*` etc.) and the ~38 blank
  admission strings; **persist** the language choice (cookie/localStorage) and make it
  apply to server-rendered pages.
- **Public/anonymous assessment** (currently login-required) if you want top-of-funnel
  self-serve scoring.
- Paid-booking **"slot lost after payment"** refund/notify path (currently a TODO —
  keeps the money and only logs).
- **CI/CD** pipeline + a **frontend Dockerfile**.
- General polish: the stale "one section built" comment in `VisaFormShell`, etc.

---

## Component reality check (what IS genuinely built)

So this isn't read as "nothing works" — the following are real and functional today
(given credentials): the **scorecard/assessment** + PDF, **booking** (free + paid),
**Stripe** checkout + webhook, the **DocuSign** integration itself, the **wallet**,
the full **~14-step visa form** with save/load, **case-document upload** (code-
complete, config-blocked), **adviser messaging**, and **support tickets**. The launch
gap is integration + go-live config, not missing feature engines.
