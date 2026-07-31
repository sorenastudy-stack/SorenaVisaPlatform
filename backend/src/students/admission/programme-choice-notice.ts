import { Prisma } from '@prisma/client';

// PR-ADMISSION-SHARED — pure, deterministic copy + audit-data builders for the
// shared programme-choice list (student + Admission Officer). Kept pure so the
// student-facing microcopy and the case-history payload are freeze-tested and
// identical across both write paths. See PHASE_ADMISSION_CHOICES_SHARED.md for the
// full "who acts → what's logged → who's notified" matrix.

export type ProgrammeChoiceAction = 'ADDED' | 'REMOVED' | 'REORDERED';
export type ActorSide = 'STUDENT' | 'STAFF';

// Human label for a programme, "Provider — Programme".
export function programmeLabel(providerName: string | null | undefined, programmeName: string | null | undefined): string {
  const prov = (providerName ?? '').trim();
  const prog = (programmeName ?? '').trim();
  return prov && prog ? `${prov} — ${prog}` : prog || prov || 'a programme';
}

// The notification the STUDENT sees in Messages & support — only ever fired for
// STAFF (Admission Officer) actions. Human microcopy, not a system-log line.
export function studentTicketNotice(action: ProgrammeChoiceAction, label: string): string {
  switch (action) {
    case 'ADDED':
      return `Your Admission Specialist added ${label} to your application list.`;
    case 'REMOVED':
      return `Your Admission Specialist removed ${label} from your application list.`;
    case 'REORDERED':
      return `Your Admission Specialist reordered your programme priorities.`;
  }
}

// Case-history (AuditLog) event type per action.
const EVENT_TYPE: Record<ProgrammeChoiceAction, string> = {
  ADDED: 'PROGRAMME_CHOICE_ADDED',
  REMOVED: 'PROGRAMME_CHOICE_REMOVED',
  REORDERED: 'PROGRAMME_CHOICE_REORDERED',
};
const AUDIT_ACTION: Record<ProgrammeChoiceAction, string> = {
  ADDED: 'CREATE', REMOVED: 'DELETE', REORDERED: 'UPDATE',
};

// The AuditLog row for a programme-choice change. Written for BOTH sides
// (entityType 'CASE', entityId = CRM caseId) so the case history is a complete,
// unified record regardless of who acted. `actorSide` in the payload lets the
// summariser render "Student …" vs "Admission Specialist …".
export function buildProgrammeChoiceAuditData(params: {
  caseId: string;
  action: ProgrammeChoiceAction;
  actorSide: ActorSide;
  actorId: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  programmeLabel?: string | null;
}): Prisma.AuditLogUncheckedCreateInput {
  return {
    userId: params.actorId ?? undefined,
    action: AUDIT_ACTION[params.action],
    eventType: EVENT_TYPE[params.action],
    entityType: 'CASE',
    entityId: params.caseId,
    newValue: {
      actorSide: params.actorSide,
      action: params.action,
      programmeLabel: params.programmeLabel ?? null,
    } as Prisma.InputJsonValue,
    actorNameSnapshot: params.actorName ?? null,
    actorRoleSnapshot: params.actorRole ?? null,
  };
}
