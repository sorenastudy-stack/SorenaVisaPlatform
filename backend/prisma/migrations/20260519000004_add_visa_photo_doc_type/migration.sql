-- Visa Section — INZ 1200 rebuild, PR-VISA2 fix (Upload photo).
-- Adds VISA_PHOTO to AdmissionDocumentType so the existing admission
-- documents pipeline (upload, signed-URL download, delete) can store the
-- visa photo without a separate table. The visa Section's UI uploads via
-- /students/me/admission/documents with documentType=VISA_PHOTO.
--
-- Lives in its own migration file because Postgres forbids ALTER TYPE ADD
-- VALUE from coexisting with other DDL in the same transaction (same
-- constraint that split 20260512000000/20260512000001 apart).

ALTER TYPE "AdmissionDocumentType" ADD VALUE 'VISA_PHOTO';
