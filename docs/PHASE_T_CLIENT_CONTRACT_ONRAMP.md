# PHASE-T — Client contract on-ramp fix

The client portal blocked the contract → payment journey in two places. The
intended flow is **sign (email) → pay**, and signing is **email-only by design**.
This fixes both breaks — frontend only, no backend/schema change.

## 1. What this PR does

- **Break A** — the "Sign your engagement letter" (`CONTRACT`-kind) next-step
  button no longer links to the payment-gated documents page. It now shows the
  honest **"Check your email"** guidance, matching the banner. Signing happens in
  the DocuSign email.
- **Break B** — when there's no engagement invoice yet, the documents/forms gate
  no longer shows a "Go to payment" button that loops back to My Case. It shows a
  new **"Sign your engagement letter first — payment opens once it's signed"**
  state, with no dead button.

## 2. Why option (a), not (b)

The scan asked whether to (b) wire the existing `getSigningUrl` for in-portal
embedded signing, or (a) point the client at their email.

**(b) is broken with the current send flow, so (a) was chosen.** The client
signer is added to the envelope as a **remote/email recipient with no
`clientUserId`** (the `EnvelopeRecipientSpec` has no such field; `createContract`
explicitly sends "signers lacking clientUserId" so DocuSign auto-emails them). But
`getSigningUrl` → `createRecipientView` uses `clientUserId = '1'`, which requires
an **embedded** recipient — so it would fail with `UNKNOWN_ENVELOPE_RECIPIENT` for
every current envelope. Making (b) work would require changing the *send* to
embedded signing (`clientUserId` on the client signer), which suppresses
DocuSign's auto-email (breaking the intended email-only flow), needs re-sends of
already-sent contracts, and adds a new signing-URL surface. Out of scope /
risky — noted as a follow-up in §7.

## 3. The intended order (verified, unchanged)

`portal.service.buildNextSteps` emits a `CONTRACT` step only while the contract is
`SENT`/`VIEWED`, and `INVOICE` steps only for `SENT`/`OVERDUE` invoices. The
engagement invoice (`ENG-<caseId>`, `ENGAGEMENT_FEE_CENTS` default = USD 200) is
created by `maybeCreateEngagementInvoice` **on the client's signature** (webhook
SIGNED path). So: contract SENT → "sign" step, no invoice → gate says "sign
first"; client signs → invoice created → "Pay now" appears. Payment strictly
follows signing.

## 4. Files changed (frontend only)

- `components/portal/PaymentGatePanel.tsx` — new `awaitingSignature` state (mail
  icon, "sign first" copy, no pay button, "Back to My Case").
- `app/portal/case/page.tsx` — `CONTRACT` step shows "Check your email" instead of
  the documents `Open` link; `DOCUMENT` step unchanged.
- `app/portal/case/documents/page.tsx`, `app/student/admission/page.tsx`,
  `app/student/documents/page.tsx` — pass `awaitingSignature = !payInvoiceId &&
  !processing` so the gate never renders a looping "Go to payment".
- **Test (gitignored):** `backend/scripts/test-client-contract-onramp.ts`.

## 5. Configuration

None. No env, schema, migration, or backend change. Frontend deploys via Vercel.

## 6. How to test

`backend/scripts/test-client-contract-onramp.ts` — **9/9 PASS** (real Prisma;
DocuSign/mail/R2/payments mocked). Drives the ordering the UI depends on:

- **SENT contract:** `buildNextSteps` shows a `CONTRACT` step and **no** `INVOICE`
  step; the gate state is no-invoice (`payInvoiceId` null → UI shows "sign first",
  no pay button).
- **Client signs** (simulated SIGNED path): the engagement invoice is created
  (`ENG-<caseId>`, `SENT`, USD 200, correct contact).
- **After signing:** the `CONTRACT` step is gone; an `INVOICE` "Pay now" step
  appears with the invoice id; the gate now deep-links the pay screen
  (`payInvoiceId` set).
- **Idempotent:** re-firing the signed event does not double-invoice.

Frontend `tsc` clean.

## 7. Known limitations / follow-ups

- **(b) in-portal embedded signing — follow-up.** To let the client sign inside
  the portal (better UX than digging through email), the send flow must add a
  `clientUserId` to the client signer (embedded recipient), and a new
  ownership-gated portal route must expose `getSigningUrl` (server-side: the
  case must belong to the caller, and only while the contract is `SENT`/`VIEWED`;
  audited; the return URL comes back to the portal). This also changes DocuSign's
  auto-email behaviour, so it needs deliberate design + re-sends. Not done here.
- **Prerequisite still stands:** the invoice is created by the webhook on the
  client's signature — so DocuSign Connect must be delivering verified (HMAC)
  events for the invoice to appear. That's tracked separately (Connect config);
  this PR only fixes the portal UI on-ramp.

## 8. How to extend

- Adjust the engagement fee via `ENGAGEMENT_FEE_CENTS` / `ENGAGEMENT_FEE_CURRENCY`
  (already config-driven).
- If (b) ships, swap the `CONTRACT` step's "Check your email" for a "Sign now"
  button hitting the new signing route.

## 9. Security

- **No new surface.** Option (a) is presentation-only — no new route, no new data
  read. The existing gate remains server-authoritative (`/portal/me/access` →
  `getEngagementGateState`, fail-safe locked). A client still can't reach
  documents/forms until their engagement fee is PAID.
- No client-trusted identity anywhere in the change.
- (b)'s security requirements (ownership-gated signing route, audit) are captured
  in §7 for when it's built.

## 10. Rollback procedure

- **Code-only, frontend-only.** Revert the commit — the `CONTRACT` step returns to
  the `Open` link and the gate to the previous (looping) "Go to payment". No data,
  schema, or backend change to reverse. Deploys/rolls back independently of the
  backend.
