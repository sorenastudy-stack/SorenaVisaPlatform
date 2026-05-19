-- PR-A: Step 2 personal-info expansion.
-- Adds three nullable columns. dateOfBirth is plaintext for now; future
-- encryption (matching the PR-SEC3 envelope pattern) is tracked separately.
-- maritalStatus is free-text but the API allow-lists six values.
-- hasChildren is a plain boolean.
ALTER TABLE "admission_applications" ADD COLUMN "dateOfBirth"   TIMESTAMP(3);
ALTER TABLE "admission_applications" ADD COLUMN "maritalStatus" TEXT;
ALTER TABLE "admission_applications" ADD COLUMN "hasChildren"   BOOLEAN;
