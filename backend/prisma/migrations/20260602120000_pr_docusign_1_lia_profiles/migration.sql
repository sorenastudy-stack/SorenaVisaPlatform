-- PR-DOCUSIGN-1 Step 1: LIA credential profile (lia_profiles).
--
-- 1:1 child table on users — mirrors agent_profiles. Holds the IAA
-- (Immigration Advisers Authority) licence number + a licence-cert
-- PDF (stored on local disk under ./uploads/lia-licences/<userId>/
-- via the existing multer-pending pattern; metadata denormalised on
-- this row), plus a manual-verification trail written by an
-- OWNER/ADMIN after cross-check against the IAA register.
--
-- Lifecycle: row created lazily on first profile view. Every column
-- nullable so the row can pre-exist before the LIA uploads anything.
-- The service layer is the gatekeeper for "complete" (licence number
-- + file present) and "verified" (verifiedAt + verifiedById present).
--
-- Only verified LIAs become eligible for auto-assign + contract-send;
-- that gate lands in a later step of this PR, not in this migration.
--
-- Forward-compat: adding iaaLicenceExpiryDate, iaaLicenceClass, etc.
-- later is an additive nullable-column migration with no backfill.

CREATE TABLE "lia_profiles" (
  "id"                       TEXT         NOT NULL,
  "userId"                   TEXT         NOT NULL,
  "iaaLicenceNumber"         TEXT,
  "iaaLicenceFileUrl"        TEXT,
  "iaaLicenceFileName"       TEXT,
  "iaaLicenceFileMime"       TEXT,
  "iaaLicenceSizeBytes"      INTEGER,
  "iaaLicenceVerifiedAt"     TIMESTAMP(3),
  "iaaLicenceVerifiedById"   TEXT,
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "lia_profiles_pkey"                  PRIMARY KEY ("id"),
  CONSTRAINT "lia_profiles_userId_key"            UNIQUE      ("userId"),
  CONSTRAINT "lia_profiles_iaaLicenceNumber_key"  UNIQUE      ("iaaLicenceNumber")
);

-- Owner relation: cascade so a hard-deleted LIA takes their credential
-- row with them (mirrors agent_profiles.userId).
ALTER TABLE "lia_profiles"
  ADD CONSTRAINT "lia_profiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Verifier relation: SetNull so if the OWNER/ADMIN who verified the
-- licence is later hard-deleted, attribution is lost but the
-- verification timestamp (and therefore the LIA's verified status)
-- survives as audit evidence.
ALTER TABLE "lia_profiles"
  ADD CONSTRAINT "lia_profiles_iaaLicenceVerifiedById_fkey"
    FOREIGN KEY ("iaaLicenceVerifiedById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
