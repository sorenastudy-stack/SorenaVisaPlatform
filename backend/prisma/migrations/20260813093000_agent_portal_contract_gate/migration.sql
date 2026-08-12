-- PR-AGENT-PORTAL phase 1 — the contract half of the access gate.
--
-- Purely additive. One boolean with a default, four nullable columns; every
-- existing row is valid the moment this runs.
--
-- contractSignedAt is the fact the gate reads. contractIsManualOverride is how
-- an Owner override stays distinguishable from a real signature once phase 3
-- starts writing the same column from DocuSeal -- otherwise, months later,
-- nobody can tell which agents actually have an agreement on file.
--
-- The reason column is nullable here but REQUIRED at the service boundary. The
-- database cannot express "required only when this is an override", and a
-- NOT NULL would break the phase-3 path that sets contractSignedAt with no
-- reason at all.

-- AlterTable
ALTER TABLE "affiliate_agents" ADD COLUMN     "contractClearedById" TEXT,
ADD COLUMN     "contractClearedByName" TEXT,
ADD COLUMN     "contractClearedReason" TEXT,
ADD COLUMN     "contractIsManualOverride" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "contractSignedAt" TIMESTAMP(3);
