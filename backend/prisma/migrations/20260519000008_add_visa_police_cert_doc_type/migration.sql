-- Visa Section — INZ 1200 rebuild, PR-VISA4 (Character).
-- Adds VISA_POLICE_CERTIFICATE to AdmissionDocumentType so the existing
-- admission documents pipeline (upload, signed-URL download, delete) can
-- store police certificates without a separate table. The visa Section's UI
-- uploads via /students/me/admission/documents with
-- documentType=VISA_POLICE_CERTIFICATE.
--
-- Lives in its own migration file because Postgres forbids ALTER TYPE ADD
-- VALUE from coexisting with other DDL in the same transaction — same
-- constraint that split 20260512000000/20260512000001 apart, and the same
-- split as VISA_PHOTO in PR-VISA2 (20260519000004 vs 20260519000005).

ALTER TYPE "AdmissionDocumentType" ADD VALUE 'VISA_POLICE_CERTIFICATE';
