// PR-ADMISSION-SHARED — GOLDEN freeze for the shared programme-choice copy +
// audit payload. These are the human-facing strings (student ticket notices) and
// the case-history records that back future analytics/dispute/audit, so they're
// pinned exactly and both write paths reuse them.
import {
  programmeLabel, studentTicketNotice, buildProgrammeChoiceAuditData,
} from './programme-choice-notice';
import { summarizeAuditEntry } from '../../common/audit/audit.helper';

describe('GOLDEN — programmeLabel', () => {
  it('formats "Provider — Programme"; degrades gracefully', () => {
    expect(programmeLabel('Aotearoa University', 'Bachelor of IT')).toBe('Aotearoa University — Bachelor of IT');
    expect(programmeLabel(null, 'Bachelor of IT')).toBe('Bachelor of IT');
    expect(programmeLabel('Aotearoa University', '')).toBe('Aotearoa University');
    expect(programmeLabel(null, null)).toBe('a programme');
  });
});

describe('GOLDEN — studentTicketNotice (staff→student, human microcopy)', () => {
  const L = 'Aotearoa University — Bachelor of IT';
  it('freezes the exact notice per action', () => {
    expect(studentTicketNotice('ADDED', L)).toBe('Your Admission Specialist added Aotearoa University — Bachelor of IT to your application list.');
    expect(studentTicketNotice('REMOVED', L)).toBe('Your Admission Specialist removed Aotearoa University — Bachelor of IT from your application list.');
    expect(studentTicketNotice('REORDERED', L)).toBe('Your Admission Specialist reordered your programme priorities.');
  });
});

describe('GOLDEN — audit data + case-history summary (both actor sides)', () => {
  const base = { caseId: 'case-1', actorId: 'u1', actorName: 'Jo', actorRole: 'CONSULTANT', programmeLabel: 'Aotearoa University — Bachelor of IT' };

  it('builds a CASE-scoped AuditLog row with the actor side in the payload', () => {
    const d = buildProgrammeChoiceAuditData({ ...base, action: 'ADDED', actorSide: 'STAFF' });
    expect(d.entityType).toBe('CASE');
    expect(d.entityId).toBe('case-1');
    expect(d.eventType).toBe('PROGRAMME_CHOICE_ADDED');
    expect(d.action).toBe('CREATE');
    expect(d.newValue).toEqual({ actorSide: 'STAFF', action: 'ADDED', programmeLabel: 'Aotearoa University — Bachelor of IT' });
    expect(d.actorRoleSnapshot).toBe('CONSULTANT');
  });

  it('event type + audit action map per action', () => {
    expect(buildProgrammeChoiceAuditData({ ...base, action: 'REMOVED', actorSide: 'STUDENT' }).eventType).toBe('PROGRAMME_CHOICE_REMOVED');
    expect(buildProgrammeChoiceAuditData({ ...base, action: 'REMOVED', actorSide: 'STUDENT' }).action).toBe('DELETE');
    expect(buildProgrammeChoiceAuditData({ ...base, action: 'REORDERED', actorSide: 'STUDENT' }).eventType).toBe('PROGRAMME_CHOICE_REORDERED');
    expect(buildProgrammeChoiceAuditData({ ...base, action: 'REORDERED', actorSide: 'STUDENT' }).action).toBe('UPDATE');
  });

  it('summariser renders "Admission Specialist …" vs "Student …" from the same rows', () => {
    const staffAdd = buildProgrammeChoiceAuditData({ ...base, action: 'ADDED', actorSide: 'STAFF' });
    const studentAdd = buildProgrammeChoiceAuditData({ ...base, action: 'ADDED', actorSide: 'STUDENT' });
    const summ = (d: any) => summarizeAuditEntry({ eventType: d.eventType, action: d.action, entityType: d.entityType, entityId: d.entityId, oldValue: null, newValue: d.newValue });
    expect(summ(staffAdd)).toBe('Admission Specialist added Aotearoa University — Bachelor of IT to the programme list');
    expect(summ(studentAdd)).toBe('Student added Aotearoa University — Bachelor of IT to the programme list');
    const studentReorder = buildProgrammeChoiceAuditData({ ...base, action: 'REORDERED', actorSide: 'STUDENT', programmeLabel: null });
    expect(summ(studentReorder)).toBe('Student reordered the programme priority list');
  });
});
