/**
 * PR-LIA-AUTO-ASSIGN Phase 7 (Option A) — synthetic Stripe paymentIntent
 * fixtures for the payments-webhook test suite.
 *
 * Modeled on the subset of `paymentIntent` that
 * `PaymentsController.handlePaymentSucceeded` actually reads:
 *
 *   id              → Phase-6 Payment.stripePaymentIntentId @unique
 *   amount_received → Phase-6 Payment.amount
 *   currency        → Phase-6 Payment.currency (handler defaults to 'nzd')
 *   metadata.leadId      → required gate; missing → handler early-returns
 *   metadata.paymentType → branch discriminator:
 *                          'consultation'    → consultation branch
 *                          'ACCOUNT_OPENING' → Phase-3/4 branch
 *                          (any other / absent) → subscription branch
 *   metadata.caseId      → Phase-4 trigger (only read on ACCOUNT_OPENING)
 *   metadata.type        → consultation branch only: 'ADMISSION' | 'LIA'
 *   metadata.plan        → subscription branch only: 'BASIC' | 'PRO' | 'PREMIUM'
 *
 * The factory below ties the dynamic IDs (leadId, caseId) to whatever
 * the Step-1 helper seeded — so a spec can write:
 *
 *     const ids = await seedFixture(prisma, { contractSigned: true });
 *     const evt = buildPaymentIntents(ids);
 *     await controller['handlePaymentSucceeded'](evt.accountOpeningSuccess);
 *
 * and the row the handler resolves caseId/leadId against will actually
 * exist in the DB.
 *
 * Stripe-retry fixture: the duplicate event reuses the EXACT same
 * paymentIntent.id as accountOpeningSuccess. That's the @unique
 * constraint the Phase-6 idempotency check trips on (P2002 → log +
 * early return → no double Payment row, no double assignLiaToCase
 * invocation).
 */

import type { SeededFixture } from '../helpers/db-fixtures';

/**
 * Minimal shape — the real Stripe.PaymentIntent type carries ~80
 * fields, but the handler reads ~6. Keeping the test surface to those
 * 6 makes the fixtures readable and the assertion targets obvious.
 */
export interface SyntheticPaymentIntent {
  id:               string;
  amount_received:  number;   // cents
  currency:         string;   // ISO 4217 lowercase, e.g. 'nzd'
  metadata: {
    leadId?:       string;
    caseId?:       string;
    paymentType?:  'consultation' | 'ACCOUNT_OPENING' | string;
    type?:         'ADMISSION' | 'LIA';                   // consultation branch
    plan?:         'BASIC' | 'PRO' | 'PREMIUM';            // subscription branch
  };
}

export interface PaymentIntentFixtures {
  /** Phase-3 + Phase-4 + Phase-6 path. Should trip the LIA-assign
   *  trigger when the seeded contract is signed. */
  accountOpeningSuccess: SyntheticPaymentIntent;

  /** Phase-3-only path. Goes to the consultation branch; no LIA assign. */
  consultationSuccess:   SyntheticPaymentIntent;

  /** Falls through to the subscription branch. No LIA assign,
   *  activates a Subscription via SubscriptionsService. */
  subscriptionSuccess:   SyntheticPaymentIntent;

  /** Stripe re-delivery of accountOpeningSuccess — same `id` so the
   *  Phase-6 @unique constraint on stripePaymentIntentId fires P2002,
   *  the handler logs + early-returns, and nothing downstream runs
   *  twice. The metadata is identical (Stripe re-sends the same
   *  envelope verbatim on retry). */
  accountOpeningRetry:   SyntheticPaymentIntent;
}

/**
 * Build fixtures tied to a SeededFixture so the IDs the handler
 * resolves (caseId via Contract.findFirst, leadId via Lead.findUnique)
 * actually exist in the seeded rows.
 *
 * No fixture is shared across tests by reference — each call returns
 * fresh objects, so mutating one (e.g. clearing metadata.caseId to
 * test the "missing caseId" sub-branch) doesn't bleed into the next
 * test.
 */
export function buildPaymentIntents(ids: SeededFixture): PaymentIntentFixtures {
  const { leadId, caseId } = ids;

  const accountOpeningSuccess: SyntheticPaymentIntent = {
    id:              ids.paymentIntentId.accountOpening,
    amount_received: 20000,    // $200.00 NZD in cents
    currency:        'nzd',
    metadata: {
      leadId,
      caseId,
      paymentType: 'ACCOUNT_OPENING',
    },
  };

  const consultationSuccess: SyntheticPaymentIntent = {
    id:              ids.paymentIntentId.consultation,
    amount_received: 5000,     // $50.00 NZD — ADMISSION consultation
    currency:        'nzd',
    metadata: {
      leadId,
      paymentType: 'consultation',
      type:        'ADMISSION',
      // No caseId — consultation flows aren't case-scoped.
    },
  };

  const subscriptionSuccess: SyntheticPaymentIntent = {
    id:              ids.paymentIntentId.subscription,
    amount_received: 2999,     // $29.99 NZD — BASIC plan first month
    currency:        'nzd',
    metadata: {
      leadId,
      plan: 'BASIC',
      // No paymentType — the handler's `else` branch catches anything
      // that isn't 'consultation' or 'ACCOUNT_OPENING'.
    },
  };

  // Same id as accountOpeningSuccess. Deep-cloned-by-construction
  // (not a reference share) so a test that mutates `retry` can't
  // accidentally mutate `success`.
  const accountOpeningRetry: SyntheticPaymentIntent = {
    id:              ids.paymentIntentId.accountOpening,   // ← SAME id
    amount_received: 20000,
    currency:        'nzd',
    metadata: {
      leadId,
      caseId,
      paymentType: 'ACCOUNT_OPENING',
    },
  };

  return {
    accountOpeningSuccess,
    consultationSuccess,
    subscriptionSuccess,
    accountOpeningRetry,
  };
}
