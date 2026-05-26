-- PR-LIA-10 — Immigration Officer module.
--
-- Three new tables:
--   1. immigration_officers              — collaborative profile
--   2. immigration_officer_observations  — attributed, append-only notes
--   3. case_officer_linkages             — case ↔ officer (1:1 per case)
--
-- Encryption envelope: profile_description_encrypted, body_encrypted,
-- and note_encrypted are AES-256-GCM via CryptoService. Tags are
-- plaintext String[] (categorical labels for future analytics).
--
-- Aggregates (Decision 3A): no maintained counters on
-- immigration_officers. totalCases / approvedCases / etc are
-- computed at read time from case_officer_linkages. The
-- (officerId, linkedAt) index keeps those queries cheap.

-- 1. immigration_officers
CREATE TABLE "immigration_officers" (
  "id"                            TEXT          NOT NULL,
  "fullName"                      VARCHAR(200)  NOT NULL,
  "officerCode"                   VARCHAR(64),
  "branch"                        VARCHAR(200),
  "countryOfPosting"              VARCHAR(120),
  "profileDescriptionEncrypted"   BYTEA,
  "createdById"                   TEXT          NOT NULL,
  "createdAt"                     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                     TIMESTAMP(3)  NOT NULL,

  CONSTRAINT "immigration_officers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "immigration_officers_fullName_idx"          ON "immigration_officers"("fullName");
CREATE INDEX "immigration_officers_branch_idx"            ON "immigration_officers"("branch");
CREATE INDEX "immigration_officers_countryOfPosting_idx"  ON "immigration_officers"("countryOfPosting");

ALTER TABLE "immigration_officers"
  ADD CONSTRAINT "immigration_officers_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

-- 2. immigration_officer_observations
CREATE TABLE "immigration_officer_observations" (
  "id"            TEXT          NOT NULL,
  "officerId"     TEXT          NOT NULL,
  "authorId"      TEXT          NOT NULL,
  "bodyEncrypted" BYTEA         NOT NULL,
  "tags"          TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "immigration_officer_observations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "immigration_officer_observations_officerId_createdAt_idx"
  ON "immigration_officer_observations"("officerId", "createdAt");
CREATE INDEX "immigration_officer_observations_authorId_createdAt_idx"
  ON "immigration_officer_observations"("authorId", "createdAt");

ALTER TABLE "immigration_officer_observations"
  ADD CONSTRAINT "immigration_officer_observations_officerId_fkey"
  FOREIGN KEY ("officerId") REFERENCES "immigration_officers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "immigration_officer_observations"
  ADD CONSTRAINT "immigration_officer_observations_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

-- 3. case_officer_linkages
CREATE TABLE "case_officer_linkages" (
  "id"            TEXT                NOT NULL,
  "caseId"        TEXT                NOT NULL,
  "officerId"     TEXT                NOT NULL,
  "linkedOutcome" "VisaIssueOutcome",
  "noteEncrypted" BYTEA,
  "linkedById"    TEXT                NOT NULL,
  "linkedAt"      TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "case_officer_linkages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "case_officer_linkages_caseId_key" ON "case_officer_linkages"("caseId");
CREATE UNIQUE INDEX "case_officer_linkages_caseId_officerId_key"
  ON "case_officer_linkages"("caseId", "officerId");
CREATE INDEX "case_officer_linkages_officerId_linkedAt_idx"
  ON "case_officer_linkages"("officerId", "linkedAt");
CREATE INDEX "case_officer_linkages_linkedAt_idx"
  ON "case_officer_linkages"("linkedAt");

ALTER TABLE "case_officer_linkages"
  ADD CONSTRAINT "case_officer_linkages_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "cases"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "case_officer_linkages"
  ADD CONSTRAINT "case_officer_linkages_officerId_fkey"
  FOREIGN KEY ("officerId") REFERENCES "immigration_officers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "case_officer_linkages"
  ADD CONSTRAINT "case_officer_linkages_linkedById_fkey"
  FOREIGN KEY ("linkedById") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
