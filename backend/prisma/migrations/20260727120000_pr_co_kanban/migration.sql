-- PR-CO-KANBAN — Client Officer daily task kanban. Additive only:
--   • leads: manual-postpone hold window + reason (CO override; the nurture cron
--     skips leads whose nurtureHeldUntil is in the future).
--   • tickets: nullable department for staff/CO-raised tickets (reuses the
--     VisaTicketDepartment enum; existing student-admission tickets don't set it).

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "nurtureHeldUntil" TIMESTAMP(3),
ADD COLUMN     "nurtureHoldReason" TEXT;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "department" "VisaTicketDepartment";
