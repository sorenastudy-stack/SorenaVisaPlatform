-- PR-DOCUSIGN-1 Step 2: per-signer rows for multi-party contract envelopes.
--
-- Sequential routing — one row per signer slot. Lowest routingOrder signs
-- first; envelope advances to the next slot only when the current signer
-- completes. The parent contracts.status mirrors the DocuSign envelope
-- terminal state; "fully signed" is derived from all rows here having
-- signedAt non-null (no PARTIALLY_SIGNED enum value).
--
-- Launch flows wired by this PR (the only two):
--   • Adult student:    CLIENT (1)   → LIA (2) → DIRECTOR (3)
--   • Under-18 student: GUARDIAN (1) → LIA (2) → DIRECTOR (3)
--     (the minor does NOT sign; signingOnBehalfOf captures their name)
--
-- PARTNER and FAMILY_MEMBER enum values ship now so the post-launch
-- family-visa flow is additive code, not an enum migration.
--
-- Identity is snapshotted at envelope-creation time (signerName +
-- signerEmail). userId FK is optional; SetNull on user hard-delete
-- preserves the row with snapshotted identity as audit evidence.
--
-- Why no UNIQUE on (contractId, role): family-visa envelopes can carry
-- multiple family-type signers (partner + family member) on the same
-- contract. routingOrder is the slot-uniqueness guarantee.

CREATE TYPE "ContractSignerRole" AS ENUM (
  'CLIENT',
  'GUARDIAN',
  'PARTNER',
  'FAMILY_MEMBER',
  'LIA',
  'DIRECTOR'
);

CREATE TYPE "ContractSignerStatus" AS ENUM (
  'PENDING',
  'SENT',
  'VIEWED',
  'SIGNED',
  'DECLINED'
);

CREATE TABLE "contract_signers" (
  "id"                   TEXT                   NOT NULL,
  "contractId"           TEXT                   NOT NULL,
  "role"                 "ContractSignerRole"   NOT NULL,
  "routingOrder"         INTEGER                NOT NULL,
  "signerName"           TEXT                   NOT NULL,
  "signerEmail"          TEXT                   NOT NULL,
  "signingOnBehalfOf"    TEXT,
  "userId"               TEXT,
  "status"               "ContractSignerStatus" NOT NULL DEFAULT 'PENDING',
  "viewedAt"             TIMESTAMP(3),
  "signedAt"             TIMESTAMP(3),
  "declinedAt"           TIMESTAMP(3),
  "declineReason"        TEXT,
  "docusignRecipientId"  TEXT,
  "createdAt"            TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contract_signers_pkey" PRIMARY KEY ("id")
);

-- Slot uniqueness — no two signers share a routingOrder within the same contract.
CREATE UNIQUE INDEX "contract_signers_contractId_routingOrder_key"
  ON "contract_signers" ("contractId", "routingOrder");

-- Hot read path: list signers for a given contract (every contract detail view).
CREATE INDEX "contract_signers_contractId_idx"
  ON "contract_signers" ("contractId");

-- Moderate read path: list contracts this user has signed (LIA dashboards).
CREATE INDEX "contract_signers_userId_idx"
  ON "contract_signers" ("userId");

-- Cascade on parent contract delete — signers go with the contract.
ALTER TABLE "contract_signers"
  ADD CONSTRAINT "contract_signers_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "contracts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull on user hard-delete — the snapshotted name+email above stays
-- as durable audit evidence.
ALTER TABLE "contract_signers"
  ADD CONSTRAINT "contract_signers_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
