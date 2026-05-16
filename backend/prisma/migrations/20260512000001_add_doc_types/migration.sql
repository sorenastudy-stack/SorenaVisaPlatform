-- PR-EDU1 (part 2): two new AdmissionDocumentType enum values for
-- per-education-entry notarized uploads. Split from the table migration
-- because Postgres requires ALTER TYPE ADD VALUE to run outside any
-- transaction that also performs other DDL.
--
-- IF NOT EXISTS guards make this idempotent on environments that already
-- have the values (rare; covers re-run scenarios).
ALTER TYPE "AdmissionDocumentType" ADD VALUE IF NOT EXISTS 'NOTARIZED_CERTIFICATE';
ALTER TYPE "AdmissionDocumentType" ADD VALUE IF NOT EXISTS 'NOTARIZED_TRANSCRIPT';
