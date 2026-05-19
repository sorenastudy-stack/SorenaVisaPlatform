-- Visa Section — INZ 1200 rebuild, PR-VISA2 fix (split phone numbers).
-- INZ Section 2 collects country code and phone number as two separate
-- inputs. Existing rows that pre-date this split have the full prefixed
-- number in preferredContactNumber / alternativeContactNumber; those rows
-- will reappear in the "number" field with the code still embedded — the
-- student can edit on next visit.

ALTER TABLE "visa_applications"
  ADD COLUMN "preferredContactCountryCode"    TEXT,
  ADD COLUMN "alternativeContactCountryCode"  TEXT;
