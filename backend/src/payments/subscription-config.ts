// Single source of truth for subscription-plan pricing.
//
// Mirrors booking/session-config.ts: the amount is server-derived from the plan
// identifier and is NEVER trusted from the request body. The previous flow read
// `amountNZD` off the request and only fell back to a server price for KNOWN
// plans — so an unknown/forged plan string reached the client-supplied amount
// (price tampering). Pricing lives ONLY here now.
//
// ⚠️ CURRENCY IS STALE. These amounts are NZD, inconsistent with the USD
// session-pricing work (booking/session-config.ts uses USD). The subscription
// checkout has NO callers today (legacy/unused), so this is preserved verbatim
// (behaviour-preserving — relabelling to USD would change what a customer is
// charged) with `currency` made explicit. Before subscriptions ship, product
// must decide the currency + amounts; then it's a one-line change per plan here.

export type SubscriptionPlan = 'BASIC' | 'PRO' | 'PREMIUM';

export interface PlanPrice {
  /** Integer minor units (cents) — the exact amount sent to Stripe. */
  amountCents: number;
  /** ISO 4217, lowercase for Stripe (e.g. 'nzd', 'usd'). */
  currency: string;
}

export const SUBSCRIPTION_PLANS: Record<SubscriptionPlan, PlanPrice> = {
  BASIC:   { amountCents: 2999, currency: 'nzd' }, // was $29.99 NZD
  PRO:     { amountCents: 4999, currency: 'nzd' }, // was $49.99 NZD
  PREMIUM: { amountCents: 9999, currency: 'nzd' }, // was $99.99 NZD
};

// null for an unknown/forged plan — callers MUST reject rather than fall back
// to any client-supplied amount.
export function getPlanPrice(plan: string): PlanPrice | null {
  return (SUBSCRIPTION_PLANS as Record<string, PlanPrice>)[plan] ?? null;
}
