-- Visa Section — INZ 1200 rebuild, PR-VISA9 (Background details).
-- Flat set of 10 Y/N declarations covering Section 9: cultural
-- positions, political appointments/associations, intelligence /
-- ill-treatment / armed conflict / violent-group / war-crimes /
-- militia associations, and a detention-history flag.
--
-- All columns are nullable so the student can save a partial draft.
-- Required-ness is enforced in the UI's save validator.

ALTER TABLE "visa_applications"
  ADD COLUMN "heldReligiousCulturalPosition" BOOLEAN,
  ADD COLUMN "heldPoliticalAppointment"      BOOLEAN,
  ADD COLUMN "hadPoliticalAssociation"       BOOLEAN,
  ADD COLUMN "associatedIntelligenceAgency"  BOOLEAN,
  ADD COLUMN "witnessedIllTreatment"         BOOLEAN,
  ADD COLUMN "involvedArmedConflict"         BOOLEAN,
  ADD COLUMN "associatedViolentGroup"        BOOLEAN,
  ADD COLUMN "involvedWarCrimes"             BOOLEAN,
  ADD COLUMN "memberLiberationMilitia"       BOOLEAN,
  ADD COLUMN "everDetainedImprisoned"        BOOLEAN;
