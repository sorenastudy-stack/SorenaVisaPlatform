-- PR-FILES-1 — add fileUrl to the two visa document tables.
--
-- Foundation for the visa document upload feature. Both tables today
-- store metadata only (originalFilename / mimeType / sizeBytes /
-- uploadedAt) — the file bytes never reach the backend. PR-FILES-1 is
-- the first step toward stored uploads: it gives each row a place to
-- record the server-side path the eventual upload pipeline will write
-- to (and the existing files/signed/:token controller will serve from).
--
-- Why nullable, no default:
--   - Existing rows have no file on disk, so a NOT NULL column would
--     need a placeholder that misrepresents reality.
--   - The metadata-first / bytes-later semantics carry over: a row
--     created during a draft save still has no file yet, and the
--     service shouldn't have to fabricate a value just to satisfy a
--     NOT NULL constraint.
--   - Whether a file is downloadable is therefore a simple
--     `fileUrl IS NOT NULL` check at the boundary (the same shape
--     case-documents.service.ts already uses for VISA_SUPPORTING via
--     the `downloadable` flag — it just always returns false today).
--
-- No other columns added: originalFilename, mimeType, sizeBytes, and
-- uploadedAt are already present on both tables and used as-is.
--
-- Hand-written, applied via `prisma migrate deploy` — same convention
-- as every prior PR. (Never `prisma migrate dev`: prior comments in
-- this folder document the drift it tends to pick up.)

-- ─── 1. visa_supporting_documents ───────────────────────────────────
ALTER TABLE "visa_supporting_documents"
  ADD COLUMN "fileUrl" TEXT;

-- ─── 2. visa_other_evidence_entries ─────────────────────────────────
ALTER TABLE "visa_other_evidence_entries"
  ADD COLUMN "fileUrl" TEXT;
