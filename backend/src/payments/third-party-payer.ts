// PR-CHECKLIST item 11 — "someone other than the client is paying".
//
// Nothing modelled this before. A payment link carried leadId/caseId and an
// amount, so a fee settled by a parent, an employer or a sponsor was
// indistinguishable in the record from one the client paid themselves.
//
// This is a compliance artefact, not a convenience field. In an immigration
// practice, who paid and what they are to the applicant is a source-of-funds
// question; "an unnamed third party paid" is the answer nobody wants to give
// later. So the payer's name, contact and relationship are captured at the
// moment the link is created, travel with the Stripe metadata, and land on the
// Payment row the webhook writes.
//
// No migration: Payment.metadata is an existing Json column and the webhook
// already persists paymentIntent.metadata into it verbatim. Stamping these keys
// into the link's metadata is therefore sufficient for them to survive.

// Relationship is a fixed list rather than free text so the question "which
// payments were settled by a third party, and by whom" stays answerable. OTHER
// exists because reality outruns any list, and forcing a wrong choice is worse
// than recording an honest one.
export const PAYER_RELATIONSHIPS = [
  'PARENT',
  'SPOUSE',
  'RELATIVE',
  'EMPLOYER',
  'SPONSOR',
  'AGENT',
  'OTHER',
] as const;

export type PayerRelationship = (typeof PAYER_RELATIONSHIPS)[number];

export interface ThirdPartyPayer {
  name: string;
  email: string;
  relationship: PayerRelationship;
}

// Stripe metadata is a flat string map, capped at 50 keys and 500 characters per
// value. Three flat keys, prefixed so they cannot collide with the leadId /
// caseId / paymentType keys already in that bucket.
const KEY_NAME = 'thirdPartyPayerName';
const KEY_EMAIL = 'thirdPartyPayerEmail';
const KEY_RELATIONSHIP = 'thirdPartyPayerRelationship';

const STRIPE_VALUE_LIMIT = 500;

const clip = (s: string) => s.trim().slice(0, STRIPE_VALUE_LIMIT);

/** The metadata keys for a payer, or an empty object when the client pays. */
export function payerMetadata(payer?: ThirdPartyPayer | null): Record<string, string> {
  if (!payer) return {};
  return {
    [KEY_NAME]: clip(payer.name),
    [KEY_EMAIL]: clip(payer.email),
    [KEY_RELATIONSHIP]: payer.relationship,
  };
}

/**
 * Read a payer back off a stored Payment.metadata blob.
 *
 * Returns null when the client paid for themselves, which is both the default
 * and the case for every payment recorded before this existed — absence means
 * "no third party was declared", never "we lost it".
 */
export function readPayerFromMetadata(metadata: unknown): ThirdPartyPayer | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  const name = typeof m[KEY_NAME] === 'string' ? (m[KEY_NAME] as string) : '';
  if (!name.trim()) return null;
  const relationship = m[KEY_RELATIONSHIP];
  return {
    name,
    email: typeof m[KEY_EMAIL] === 'string' ? (m[KEY_EMAIL] as string) : '',
    relationship: (PAYER_RELATIONSHIPS as readonly string[]).includes(relationship as string)
      ? (relationship as PayerRelationship)
      : 'OTHER',
  };
}
