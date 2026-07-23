-- PR-CONTRACT-GATE (Phase A) — LIA verdict on an LIA-type consultation, used to
-- unlock contract-send for a red-flagged (HS4) lead. All additive + nullable →
-- safe on the live table; no existing Consultation usage changes.
ALTER TABLE "consultations" ADD COLUMN "decision" "LegalDecision";
ALTER TABLE "consultations" ADD COLUMN "decisionNotes" TEXT;
ALTER TABLE "consultations" ADD COLUMN "decidedAt" TIMESTAMP(3);
ALTER TABLE "consultations" ADD COLUMN "decidedById" TEXT;
