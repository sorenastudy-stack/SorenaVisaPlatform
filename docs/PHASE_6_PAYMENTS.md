# Phase 6 — Payments (Stripe Consultation Links)

**Date completed:** 2026-04-27
**Status:** Live in production
**Backend commit:** ef8a26e

---

## 1. What this phase does

Sorena staff can now generate Stripe payment links for consultation fees directly from the admin dashboard. When a staff member opens a lead and clicks "Take Action" → "Create Payment Link", the backend calls Stripe, generates a hosted Stripe Checkout link tied to a specific consultation type and amount, and returns the URL. Staff can then share the link with the prospect via email or WhatsApp. The prospect pays on Stripe's hosted page; Stripe handles all card data, 3DS, and receipts. No card data ever touches Sorena's servers.

This phase is **payment link generation only**. Webhook-driven payment status sync (marking a lead as "Paid" automatically when the prospect completes payment) is **not** included — see Known Limitations.

## 2. Files created or changed

| File | Purpose |
|---|---|
| `backend/src/payments/payments.module.ts` | NestJS module wiring up the payments service and controller |
| `backend/src/payments/payments.service.ts` | Wraps the Stripe SDK; exposes `createConsultationPaymentLink(type, amount, leadId)` |
| `backend/src/payments/payments.controller.ts` | REST endpoint `POST /api/payments/consultation-link` consumed by the admin dashboard |
| `backend/src/payments/dto/create-payment-link.dto.ts` | DTO with class-validator rules for incoming requests |
| `backend/src/app.module.ts` | Registers `PaymentsModule` |
| `backend/Dockerfile` | **Fixed:** runs `npx prisma generate` in the builder stage before `nest build`; copies generated Prisma client into the production image. This was required because the build was failing on Railway with 170 TypeScript errors caused by missing Prisma types at compile time. |
| `frontend/src/app/admin/leads/[id]/page.tsx` (or equivalent) | "Create Payment Link" button + handler in the lead detail panel |
| `docs/PHASE_6_PAYMENTS.md` | This document |

## 3. Database tables / columns added

**None in this phase.** Payments are created on Stripe and not persisted server-side yet. When webhook integration is added (see "How to extend"), a `payments` table will be required.

## 4. Environment variables added

Set in Railway → SorenaVisaPlatform → Variables:

| Name | Used for |
|---|---|
| `STRIPE_SECRET_KEY` | Server-side Stripe SDK calls. **Live key** (`sk_live_...`). Never logged, never returned to the client. |
| `STRIPE_WEBHOOK_SECRET` | Reserved for webhook signature verification once Phase 6.5 is implemented. Already set; not yet used. |

The frontend uses no Stripe key directly — it only calls the backend, which holds the secret.

## 5. Third-party services connected

| Service | Why | Where to manage |
|---|---|---|
| Stripe | Payment link generation, hosted checkout, card processing | https://dashboard.stripe.com — Live mode |

## 6. How to test it works

1. Log in to the admin dashboard at the production frontend URL.
2. Open any lead.
3. Click **Take Action** → **Create Payment Link**.
4. Select a consultation type (e.g. Initial Assessment).
5. Click **Generate**. A Stripe URL is returned and displayed.
6. Open the URL in an incognito window. The Stripe-hosted checkout page should load with the correct consultation name and amount.
7. (Optional, live mode) Pay with a real card you control. The payment should succeed and appear in the Stripe dashboard at https://dashboard.stripe.com/payments within seconds.
8. (Optional, test mode) If using a test key, use card `4242 4242 4242 4242`, any future expiry, any CVC, any postcode.

## 7. Known limitations

- **No webhook listener yet.** When a prospect pays, the lead status is **not** automatically updated in the CRM. Staff must check Stripe manually or wait for Phase 6.5.
- **No payment record stored locally.** All payment data lives in Stripe.
- **No refund flow** exposed in the admin UI. Refunds must be done from the Stripe dashboard.
- **No installment plans.** Original roadmap mentioned installments; not yet built.
- **Live keys only.** No environment switch between test and live mode — production Railway uses live keys.

## 8. How a future developer would extend this

**To add webhook-driven status sync (Phase 6.5):**
1. Create a `webhooks` controller at `backend/src/payments/webhooks.controller.ts` exposing `POST /api/payments/webhook`.
2. Use the Stripe SDK's `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET` to verify the signature.
3. Handle the `checkout.session.completed` event: look up the lead by the `client_reference_id` (set this when creating the link) and update its status to "Paid".
4. Register the webhook URL `https://app.sorenavisa.com/api/payments/webhook` in https://dashboard.stripe.com/webhooks.

**To add a `payments` table:**
1. Add a `Payment` model to `backend/prisma/schema.prisma` with fields: `id`, `leadId`, `stripeSessionId`, `amount`, `currency`, `status`, `createdAt`.
2. Run `npx prisma migrate dev --name add_payments`.
3. Persist a record in `payments.service.ts` immediately after `stripe.checkout.sessions.create` succeeds.

**To add installments:**
Use Stripe's "Payment Plans" or create multiple Checkout Sessions. Stripe's native "Subscriptions" can also work for fixed instalment counts.

## 9. Security layers applied

From the project's 10 mandatory security layers:

| # | Layer | Where applied |
|---|---|---|
| 3 | Secrets in Vercel/Railway env vars, never in code | `STRIPE_SECRET_KEY` lives only in Railway Variables. `.env.example` lists the name with a blank value. |
| 4 | HTTPS only | Railway domain serves HTTPS by default. |
| 5 | Rate limiting | `@nestjs/throttler` already global; payment endpoint inherits the default rate limit. |
| 7 | Input validation | `CreatePaymentLinkDto` uses `class-validator`; the global `ValidationPipe` rejects malformed requests before they reach the service. |

**Out of scope this phase:** RLS (no DB writes), audit log (no DB writes), file upload limits (no uploads), auto-logout (frontend session policy unchanged).

### Incident note (2026-04-27)
The original Stripe live secret key was briefly exposed in a screenshot during a debugging session. The key was rotated within ~15 minutes via Stripe Dashboard → API keys → Rotate key → "Now". Stripe Payments and Security history were reviewed for the affected window — no unauthorized activity. The new key was placed directly into Railway without ever appearing in chat, screenshots, or commits. **Going forward: never screenshot Railway Variables, Stripe API keys, or any page that may render a secret value.**

## 10. Rollback instructions

**To roll back the Dockerfile fix without rolling back payment code:**
The fix is required for any backend deploy to succeed; do not roll it back independently.

**To roll back the entire payments feature:**
1. In a terminal at the repo root:

## 11. Debug log — Prisma on Alpine (2026-04-27)

After the initial Phase 6 deploy, the backend crashed on startup with:

```
PrismaClientInitializationError: 'PrismaClient' needs to be constructed with a non-empty, valid 'PrismaClientOptions'
```

This error was misleading. The real cause was Prisma binary mismatch on Alpine Linux, not options. Two fixes were required together.

**Fix A — schema.prisma generator block must include explicit binaryTargets:**

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
}
```

Without this, `prisma generate` only emits binaries for the host that ran it (glibc on dev machines), and Alpine's musl libc cannot execute them at runtime.

**Fix B — Dockerfile must install openssl in both build and production stages:**

```dockerfile
RUN apk add --no-cache openssl
```

Alpine ships without openssl by default; Prisma's query engine links against it.

Also discovered: the previous Dockerfile attempted to copy `node_modules/.prisma` and `node_modules/@prisma` from the builder stage to the production stage. This is fragile — the canonical pattern is to install prod deps fresh and run `npx prisma generate` again in the production stage. The current Dockerfile follows this pattern.

**Prisma version note:** Prisma 7.7.0 does NOT accept `datasources` or `datasourceUrl` as constructor options in TypeScript — both fail with `TS2353`. The correct pattern for v7 is bare `super()` and let Prisma read `DATABASE_URL` from `process.env` directly.
