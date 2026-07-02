-- PR-WALLET slice 3 (b) — double-spend guard.
-- Mirrors the slice-1 "refund once" partial-unique index: a consultation may be
-- paid from the wallet (SPEND_BOOKING) at most once, so two concurrent /
-- retried checkouts can't drain the wallet twice for the same booking. The
-- second insert hits this index → P2002 → clean 409. Partial unique index is
-- not expressible in the Prisma schema, so it lives here only (Prisma stays
-- unaware, which is safe under the db-execute pattern). Additive + idempotent.
--
-- Note: this index covers ONLY SPEND_BOOKING and is disjoint from the slice-1
-- "refund once" index (REFUND_* kinds), so one consultation can carry exactly
-- one SPEND_BOOKING plus one REFUND_* row without colliding.

CREATE UNIQUE INDEX IF NOT EXISTS "wallet_transaction_spend_once_idx"
  ON "wallet_transaction" ("relatedConsultationId")
  WHERE "type" = 'SPEND_BOOKING'
    AND "relatedConsultationId" IS NOT NULL;
