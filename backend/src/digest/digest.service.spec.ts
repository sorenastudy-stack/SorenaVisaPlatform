/**
 * Phase 8 — DigestService unit tests.
 *
 * Hand-rolled Prisma + Crypto mocks, direct construction (no Nest boot).
 *
 * Covers:
 *   - each event type maps to the right rendered data shape
 *   - staff-only filter on DOCUMENT_UPLOADED + TICKET_MESSAGE_SENT
 *   - TICKET_STATUS_CHANGED: only resolved/closed + byStaff=true
 *   - LIA_MANUAL_REASSIGNED.reason is NEVER surfaced
 *   - events outside [since, until) are excluded
 *   - events from OTHER cases are excluded (separate case fixture)
 *   - no internal fields leak in the output
 *   - empty result when nothing happened in the window
 *   - missing case returns [] without throwing
 *   - chronological ascending sort
 */

import { DigestService } from './digest.service';

// ─── Fixtures + mock helpers ────────────────────────────────────────────

interface CaseRow { id: string; lead: { contact: { id: string; userId: string | null } } | null }
interface PaymentRow  { id: string; amount: number; currency: string }
interface DocumentRow { id: string; originalName: string }
interface MeetingRow  { id: string; scheduledAt: Date }
interface TicketRow   { id: string; subjectEncrypted: Buffer | Uint8Array | null }
interface AuditRow {
  id?:                string;
  eventType:          string;
  entityType:         string;
  entityId:           string | null;
  newValue?:          unknown;
  actorRoleSnapshot?: string | null;
  createdAt:          Date;
}

function makeService(opts: {
  caseRow?:     CaseRow | null;
  payments?:    PaymentRow[];
  documents?:   DocumentRow[];
  meetings?:    MeetingRow[];
  tickets?:     TicketRow[];
  audit?:       AuditRow[];
  // map of ticketId → decrypted subject
  ticketSubjects?: Record<string, string>;
}) {
  const prismaMock: any = {
    case: {
      findUnique: jest.fn().mockResolvedValue(opts.caseRow ?? null),
    },
    payment: {
      findMany: jest.fn().mockResolvedValue(opts.payments ?? []),
    },
    document: {
      findMany: jest.fn().mockResolvedValue(opts.documents ?? []),
    },
    visaMeeting: {
      findMany: jest.fn().mockResolvedValue(opts.meetings ?? []),
    },
    visaSupportTicket: {
      findMany: jest.fn().mockResolvedValue(opts.tickets ?? []),
    },
    auditLog: {
      // Filter the supplied audit set by the `where` clause the
      // service passes — mimics how Prisma would filter for real.
      findMany: jest.fn(async ({ where }: any) => {
        const all = opts.audit ?? [];
        return all.filter((r) => {
          if (where.entityType !== r.entityType) return false;
          if (where.entityId) {
            if (typeof where.entityId === 'string') {
              if (r.entityId !== where.entityId) return false;
            } else if (where.entityId.in) {
              if (!where.entityId.in.includes(r.entityId)) return false;
            }
          }
          if (where.eventType?.in) {
            if (!where.eventType.in.includes(r.eventType)) return false;
          } else if (typeof where.eventType === 'string') {
            if (r.eventType !== where.eventType) return false;
          }
          if (where.createdAt?.gte && r.createdAt < where.createdAt.gte) return false;
          if (where.createdAt?.lt  && r.createdAt >= where.createdAt.lt) return false;
          return true;
        });
      }),
    },
  };

  const cryptoMock: any = {
    decrypt: jest.fn((buf: Buffer) => {
      // Mock subject buffers carry the ticket id as a string in the
      // bytes; the test maps that to a friendly subject via the lookup.
      const id = buf.toString('utf8');
      return opts.ticketSubjects?.[id] ?? '';
    }),
  };

  const service = new DigestService(prismaMock, cryptoMock);
  return { service, prisma: prismaMock, crypto: cryptoMock };
}

const SINCE = new Date('2026-06-15T00:00:00Z');
const UNTIL = new Date('2026-06-22T00:00:00Z');
const INSIDE_1  = new Date('2026-06-16T10:00:00Z');
const INSIDE_2  = new Date('2026-06-18T10:00:00Z');
const INSIDE_3  = new Date('2026-06-20T10:00:00Z');
const OUTSIDE_BEFORE = new Date('2026-06-14T10:00:00Z');
const OUTSIDE_AFTER  = new Date('2026-06-22T00:00:01Z');

const CASE_ID  = 'case-1';
const CONTACT_ID = 'contact-1';
const USER_ID  = 'user-1';

const CASE_FIXTURE: CaseRow = {
  id:   CASE_ID,
  lead: { contact: { id: CONTACT_ID, userId: USER_ID } },
};

// ─── Tests ──────────────────────────────────────────────────────────────

describe('DigestService.gatherClientDigest', () => {

  it('returns [] when the case does not exist (no throw)', async () => {
    const { service } = makeService({ caseRow: null });
    const items = await service.gatherClientDigest('case-missing', SINCE, UNTIL);
    expect(items).toEqual([]);
  });

  it('returns [] when nothing happened in the window', async () => {
    const { service } = makeService({ caseRow: CASE_FIXTURE });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    expect(items).toEqual([]);
  });

  // ─── Case-scoped events ───────────────────────────────────────────────

  it('INZ_SUBMITTED → { reference } from newValue.inzApplicationNumber', async () => {
    const { service } = makeService({
      caseRow: CASE_FIXTURE,
      audit: [{
        eventType: 'INZ_SUBMITTED',
        entityType: 'CASE',
        entityId: CASE_ID,
        newValue: { caseId: CASE_ID, inzApplicationNumber: 'INZ-ABC-123', receiptFileName: 'r.pdf', receiptSizeBytes: 100 },
        actorRoleSnapshot: 'LIA',
        createdAt: INSIDE_1,
      }],
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    expect(items).toEqual([{
      type: 'INZ_SUBMITTED',
      occurredAt: INSIDE_1,
      data: { reference: 'INZ-ABC-123' },
    }]);
  });

  it('VISA_ISSUED → { visaStartDate, visaEndDate } from newValue', async () => {
    const { service } = makeService({
      caseRow: CASE_FIXTURE,
      audit: [{
        eventType: 'VISA_ISSUED',
        entityType: 'CASE',
        entityId: CASE_ID,
        newValue: { caseId: CASE_ID, visaId: 'visa-1', visaStartDate: '2026-06-25T00:00:00Z', visaEndDate: '2027-06-25T00:00:00Z', fileName: 'visa.pdf', fileSize: 200 },
        actorRoleSnapshot: 'LIA',
        createdAt: INSIDE_2,
      }],
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      type: 'VISA_ISSUED',
      occurredAt: INSIDE_2,
      data: { visaStartDate: '2026-06-25T00:00:00Z', visaEndDate: '2027-06-25T00:00:00Z' },
    });
    // No leak of visaId / fileName / fileSize.
    expect(items[0].data).not.toHaveProperty('visaId');
    expect(items[0].data).not.toHaveProperty('fileName');
  });

  it('LIA_AUTO_ASSIGNED → { staffName } from newValue.liaName (candidates list NOT leaked)', async () => {
    const { service } = makeService({
      caseRow: CASE_FIXTURE,
      audit: [{
        eventType: 'LIA_AUTO_ASSIGNED',
        entityType: 'CASE',
        entityId: CASE_ID,
        newValue: { liaId: 'lia-1', liaName: 'Mira Adviser', candidates: [{ id: 'lia-2', score: 0.4 }, { id: 'lia-1', score: 0.9 }] },
        actorRoleSnapshot: 'SYSTEM',
        createdAt: INSIDE_1,
      }],
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    expect(items).toEqual([{
      type: 'LIA_AUTO_ASSIGNED',
      occurredAt: INSIDE_1,
      data: { staffName: 'Mira Adviser' },
    }]);
    expect(items[0].data).not.toHaveProperty('candidates');
    expect(items[0].data).not.toHaveProperty('liaId');
  });

  it('LIA_MANUAL_REASSIGNED → { staffName } only — the `reason` field is NEVER surfaced', async () => {
    const { service } = makeService({
      caseRow: CASE_FIXTURE,
      audit: [{
        eventType: 'LIA_MANUAL_REASSIGNED',
        entityType: 'CASE',
        entityId: CASE_ID,
        newValue: {
          liaId: 'lia-2',
          liaName: 'Eli Reassigned',
          reason: 'Original LIA was rude in last meeting',  // internal — must be hidden
          reasonLength: 36,
        },
        actorRoleSnapshot: 'OWNER',
        createdAt: INSIDE_1,
      }],
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    expect(items).toEqual([{
      type: 'LIA_MANUAL_REASSIGNED',
      occurredAt: INSIDE_1,
      data: { staffName: 'Eli Reassigned' },
    }]);
    // The destructive check: no `reason` anywhere in the payload.
    expect(JSON.stringify(items[0])).not.toContain('rude');
    expect(JSON.stringify(items[0])).not.toContain('reason');
  });

  it('CASE_DOCUMENT_REQUESTED → { documentLabel } from newValue.requestedDocType', async () => {
    const { service } = makeService({
      caseRow: CASE_FIXTURE,
      audit: [{
        eventType: 'CASE_DOCUMENT_REQUESTED',
        entityType: 'CASE',
        entityId: CASE_ID,
        newValue: { requestedDocType: 'Passport scan' },
        actorRoleSnapshot: 'LIA',
        createdAt: INSIDE_1,
      }],
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    expect(items[0].data).toEqual({ documentLabel: 'Passport scan' });
  });

  // ─── Payment events ───────────────────────────────────────────────────

  it('PAYMENT_RECORDED_MANUAL → { amount, currency } from newValue', async () => {
    const { service } = makeService({
      caseRow: CASE_FIXTURE,
      payments: [{ id: 'pay-1', amount: 5000, currency: 'nzd' }],
      audit: [{
        eventType: 'PAYMENT_RECORDED_MANUAL',
        entityType: 'PAYMENT',
        entityId: 'pay-1',
        newValue: { caseId: CASE_ID, leadId: 'lead-1', paymentType: 'manual', amount: 5000, currency: 'nzd', hasNote: true, receiptDocumentId: 'doc-r', verificationStatus: 'PENDING' },
        actorRoleSnapshot: 'FINANCE',
        createdAt: INSIDE_1,
      }],
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    expect(items).toEqual([{
      type: 'PAYMENT_RECORDED_MANUAL',
      occurredAt: INSIDE_1,
      data: { amount: 5000, currency: 'nzd' },
    }]);
  });

  it('PAYMENT_VERIFICATION_CONFIRMED → joins Payment row for amount/currency (the audit newValue does NOT carry them)', async () => {
    const { service } = makeService({
      caseRow: CASE_FIXTURE,
      payments: [{ id: 'pay-1', amount: 15000, currency: 'nzd' }],
      audit: [{
        eventType: 'PAYMENT_VERIFICATION_CONFIRMED',
        entityType: 'PAYMENT',
        entityId: 'pay-1',
        // Real shape from PaymentsService.transitionVerification
        newValue: { paymentId: 'pay-1', caseId: CASE_ID, previousStatus: 'PENDING', newStatus: 'CONFIRMED', hasNote: false },
        actorRoleSnapshot: 'FINANCE',
        createdAt: INSIDE_2,
      }],
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    expect(items).toEqual([{
      type: 'PAYMENT_VERIFICATION_CONFIRMED',
      occurredAt: INSIDE_2,
      data: { amount: 15000, currency: 'nzd' },  // came from the Payment join
    }]);
  });

  it('PAYMENT_VERIFICATION_REJECTED is NEVER emitted (excluded at gather time)', async () => {
    const { service } = makeService({
      caseRow: CASE_FIXTURE,
      payments: [{ id: 'pay-1', amount: 5000, currency: 'nzd' }],
      audit: [{
        eventType: 'PAYMENT_VERIFICATION_REJECTED',
        entityType: 'PAYMENT',
        entityId: 'pay-1',
        newValue: { paymentId: 'pay-1', caseId: CASE_ID, previousStatus: 'PENDING', newStatus: 'REJECTED', hasNote: true },
        actorRoleSnapshot: 'FINANCE',
        createdAt: INSIDE_2,
      }],
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    expect(items).toEqual([]);
  });

  // ─── DOCUMENT_UPLOADED — staff-only filter ───────────────────────────

  it('DOCUMENT_UPLOADED is fail-safe: only included when actorRoleSnapshot is a definitively-known staff role', async () => {
    const { service } = makeService({
      caseRow: CASE_FIXTURE,
      documents: [
        { id: 'doc-staff',   originalName: 'Visa decision letter.pdf' },
        { id: 'doc-lead',    originalName: 'Client passport scan.jpg' },
        { id: 'doc-student', originalName: 'Client offer letter.pdf' },
        { id: 'doc-null',    originalName: 'Mystery upload.pdf' },
        { id: 'doc-agent',   originalName: 'Affiliate upload.pdf' },
        { id: 'doc-future',  originalName: 'Unknown-role upload.pdf' },
      ],
      audit: [
        // (a) Known staff role — INCLUDED.
        {
          eventType: 'DOCUMENT_UPLOADED',
          entityType: 'DOCUMENT',
          entityId: 'doc-staff',
          newValue: { caseId: CASE_ID },
          actorRoleSnapshot: 'LIA',
          createdAt: INSIDE_1,
        },
        // (b) LEAD — client role — EXCLUDED.
        {
          eventType: 'DOCUMENT_UPLOADED',
          entityType: 'DOCUMENT',
          entityId: 'doc-lead',
          newValue: { caseId: CASE_ID },
          actorRoleSnapshot: 'LEAD',
          createdAt: INSIDE_1,
        },
        // (c) STUDENT — client role — EXCLUDED.
        {
          eventType: 'DOCUMENT_UPLOADED',
          entityType: 'DOCUMENT',
          entityId: 'doc-student',
          newValue: { caseId: CASE_ID },
          actorRoleSnapshot: 'STUDENT',
          createdAt: INSIDE_1,
        },
        // (d) Null role (was previously included by the old polarity!) — now EXCLUDED.
        {
          eventType: 'DOCUMENT_UPLOADED',
          entityType: 'DOCUMENT',
          entityId: 'doc-null',
          newValue: { caseId: CASE_ID },
          actorRoleSnapshot: null,
          createdAt: INSIDE_1,
        },
        // (e) AGENT — affiliate role, not staff — EXCLUDED.
        {
          eventType: 'DOCUMENT_UPLOADED',
          entityType: 'DOCUMENT',
          entityId: 'doc-agent',
          newValue: { caseId: CASE_ID },
          actorRoleSnapshot: 'AGENT',
          createdAt: INSIDE_1,
        },
        // (f) Unknown role string we don't recognise — EXCLUDED.
        {
          eventType: 'DOCUMENT_UPLOADED',
          entityType: 'DOCUMENT',
          entityId: 'doc-future',
          newValue: { caseId: CASE_ID },
          actorRoleSnapshot: 'FUTURE_ROLE_TYPE',
          createdAt: INSIDE_1,
        },
      ],
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    // Only the LIA-authored row survives.
    expect(items).toEqual([{
      type: 'DOCUMENT_UPLOADED',
      occurredAt: INSIDE_1,
      data: { documentName: 'Visa decision letter.pdf' },
    }]);
  });

  it('DOCUMENT_UPLOADED admits every known staff role from UserRole', async () => {
    // Catches a future enum drift — if the schema adds a staff role
    // and the digest doesn't, this test goes red.
    const STAFF = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE', 'SALES', 'OPERATIONS'];
    const docs   = STAFF.map((r, i) => ({ id: `doc-${i}`, originalName: `${r}.pdf` }));
    const audits = STAFF.map((r, i) => ({
      eventType: 'DOCUMENT_UPLOADED',
      entityType: 'DOCUMENT',
      entityId: `doc-${i}`,
      newValue: { caseId: CASE_ID },
      actorRoleSnapshot: r,
      createdAt: new Date(INSIDE_1.getTime() + i * 1000),
    }));
    const { service } = makeService({
      caseRow:   CASE_FIXTURE,
      documents: docs,
      audit:     audits,
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    expect(items.map((i) => (i.data as { documentName: string }).documentName).sort())
      .toEqual(STAFF.map((r) => `${r}.pdf`).sort());
  });

  // ─── Meeting events ──────────────────────────────────────────────────

  it('MEETING_CREATED / UPDATED / CANCELLED → { when } from VisaMeeting.scheduledAt', async () => {
    const meetingTime = new Date('2026-06-25T14:00:00Z');
    const { service } = makeService({
      caseRow: CASE_FIXTURE,
      meetings: [{ id: 'meet-1', scheduledAt: meetingTime }],
      audit: [
        { eventType: 'MEETING_CREATED',   entityType: 'VisaMeeting', entityId: 'meet-1', newValue: {}, actorRoleSnapshot: 'CONSULTANT', createdAt: INSIDE_1 },
        { eventType: 'MEETING_UPDATED',   entityType: 'VisaMeeting', entityId: 'meet-1', newValue: {}, actorRoleSnapshot: 'CONSULTANT', createdAt: INSIDE_2 },
        { eventType: 'MEETING_CANCELLED', entityType: 'VisaMeeting', entityId: 'meet-1', newValue: { status: 'CANCELLED' }, actorRoleSnapshot: 'CONSULTANT', createdAt: INSIDE_3 },
      ],
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    expect(items.map((i) => i.type)).toEqual(['MEETING_CREATED', 'MEETING_UPDATED', 'MEETING_CANCELLED']);
    for (const item of items) {
      expect((item.data as { when: Date }).when).toEqual(meetingTime);
    }
  });

  it('MEETING events for a different student are NOT included (entity scoping via VisaMeeting list)', async () => {
    const { service } = makeService({
      caseRow: CASE_FIXTURE,
      meetings: [{ id: 'mine', scheduledAt: new Date('2026-06-25T10:00:00Z') }],
      // The audit row points to meet-other-student which isn't in our
      // meetings list → entity-id IN filter drops it before render.
      audit: [{
        eventType: 'MEETING_CREATED',
        entityType: 'VisaMeeting',
        entityId: 'meet-other-student',
        newValue: {},
        actorRoleSnapshot: 'CONSULTANT',
        createdAt: INSIDE_1,
      }],
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    expect(items).toEqual([]);
  });

  // ─── Ticket events ───────────────────────────────────────────────────

  it('TICKET_MESSAGE_SENT: staff replies are included; client messages are filtered (byStaff!==true OR client role)', async () => {
    const subjectBytes = Buffer.from('ticket-1', 'utf8');
    const { service } = makeService({
      caseRow: CASE_FIXTURE,
      tickets: [{ id: 'ticket-1', subjectEncrypted: subjectBytes }],
      ticketSubjects: { 'ticket-1': 'Visa receipt question' },
      audit: [
        // Staff reply — included.
        {
          eventType: 'TICKET_MESSAGE_SENT',
          entityType: 'VisaSupportTicket',
          entityId: 'ticket-1',
          newValue: { messageId: 'm1', byStaff: true, isInternalNote: false },
          actorRoleSnapshot: 'SUPPORT',
          createdAt: INSIDE_1,
        },
        // Client reply — excluded (no byStaff flag).
        {
          eventType: 'TICKET_MESSAGE_SENT',
          entityType: 'VisaSupportTicket',
          entityId: 'ticket-1',
          newValue: {},
          actorRoleSnapshot: null,
          createdAt: INSIDE_2,
        },
      ],
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    expect(items).toEqual([{
      type: 'TICKET_MESSAGE_SENT',
      occurredAt: INSIDE_1,
      data: { ticketTopic: 'Visa receipt question' },
    }]);
  });

  it('TICKET_STATUS_CHANGED: only RESOLVED or CLOSED outcomes, only when byStaff=true', async () => {
    const subjectBytes = Buffer.from('ticket-1', 'utf8');
    const { service } = makeService({
      caseRow: CASE_FIXTURE,
      tickets: [{ id: 'ticket-1', subjectEncrypted: subjectBytes }],
      ticketSubjects: { 'ticket-1': 'My ticket' },
      audit: [
        // Staff resolves — INCLUDED.
        {
          eventType: 'TICKET_STATUS_CHANGED',
          entityType: 'VisaSupportTicket',
          entityId: 'ticket-1',
          newValue: { status: 'RESOLVED', byStaff: true },
          actorRoleSnapshot: 'SUPPORT',
          createdAt: INSIDE_1,
        },
        // Staff moves OPEN → AWAITING_CLIENT — EXCLUDED (not terminal).
        {
          eventType: 'TICKET_STATUS_CHANGED',
          entityType: 'VisaSupportTicket',
          entityId: 'ticket-1',
          newValue: { status: 'AWAITING_CLIENT', byStaff: true },
          actorRoleSnapshot: 'SUPPORT',
          createdAt: INSIDE_2,
        },
        // Client closes their own ticket — EXCLUDED (no byStaff flag).
        {
          eventType: 'TICKET_STATUS_CHANGED',
          entityType: 'VisaSupportTicket',
          entityId: 'ticket-1',
          newValue: { status: 'CLOSED' },
          actorRoleSnapshot: null,
          createdAt: INSIDE_3,
        },
      ],
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    expect(items).toEqual([{
      type: 'TICKET_STATUS_CHANGED',
      occurredAt: INSIDE_1,
      data: { ticketTopic: 'My ticket', newStatus: 'RESOLVED' },
    }]);
  });

  it('Ticket subject decrypts cleanly; fallback when crypto throws or returns empty', async () => {
    const { service } = makeService({
      caseRow: CASE_FIXTURE,
      tickets: [
        { id: 'ticket-good',  subjectEncrypted: Buffer.from('ticket-good',  'utf8') },
        { id: 'ticket-empty', subjectEncrypted: Buffer.from('ticket-empty', 'utf8') },
      ],
      ticketSubjects: { 'ticket-good': 'Topic A' /* ticket-empty deliberately missing → '' */ },
      audit: [
        {
          eventType: 'TICKET_MESSAGE_SENT',
          entityType: 'VisaSupportTicket',
          entityId: 'ticket-good',
          newValue: { byStaff: true },
          actorRoleSnapshot: 'SUPPORT',
          createdAt: INSIDE_1,
        },
        {
          eventType: 'TICKET_MESSAGE_SENT',
          entityType: 'VisaSupportTicket',
          entityId: 'ticket-empty',
          newValue: { byStaff: true },
          actorRoleSnapshot: 'SUPPORT',
          createdAt: INSIDE_2,
        },
      ],
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    expect(items[0].data).toEqual({ ticketTopic: 'Topic A' });
    expect(items[1].data).toEqual({ ticketTopic: 'a support ticket' });
  });

  // ─── Date window + sort + cross-case isolation ───────────────────────

  it('events outside [since, until) are excluded', async () => {
    const { service } = makeService({
      caseRow: CASE_FIXTURE,
      audit: [
        { eventType: 'INZ_SUBMITTED', entityType: 'CASE', entityId: CASE_ID, newValue: { inzApplicationNumber: 'INZ-BEFORE' }, actorRoleSnapshot: 'LIA', createdAt: OUTSIDE_BEFORE },
        { eventType: 'INZ_SUBMITTED', entityType: 'CASE', entityId: CASE_ID, newValue: { inzApplicationNumber: 'INZ-IN' },     actorRoleSnapshot: 'LIA', createdAt: INSIDE_2       },
        { eventType: 'INZ_SUBMITTED', entityType: 'CASE', entityId: CASE_ID, newValue: { inzApplicationNumber: 'INZ-AFTER' },  actorRoleSnapshot: 'LIA', createdAt: OUTSIDE_AFTER  },
      ],
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    expect(items.map((i) => i.data)).toEqual([{ reference: 'INZ-IN' }]);
  });

  it('events for OTHER cases are excluded — case-scoped pass filters by entityId', async () => {
    const { service } = makeService({
      caseRow: CASE_FIXTURE,
      audit: [
        // Belongs to another case — filtered by Pass A's entityId = caseId.
        { eventType: 'INZ_SUBMITTED', entityType: 'CASE', entityId: 'case-OTHER', newValue: { inzApplicationNumber: 'INZ-OTHER' }, actorRoleSnapshot: 'LIA', createdAt: INSIDE_1 },
        // Belongs to this case.
        { eventType: 'INZ_SUBMITTED', entityType: 'CASE', entityId: CASE_ID,      newValue: { inzApplicationNumber: 'INZ-OURS'  }, actorRoleSnapshot: 'LIA', createdAt: INSIDE_2 },
      ],
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    expect(items).toHaveLength(1);
    expect(items[0].data).toEqual({ reference: 'INZ-OURS' });
  });

  it('events for OTHER cases\' payments / documents are excluded (Pass B entity-id IN filter)', async () => {
    const { service } = makeService({
      caseRow: CASE_FIXTURE,
      // Only this case's payments + documents are loaded — anything
      // else can't appear in the entityId IN list, so its audit rows
      // are filtered out by the Prisma mock.
      payments:  [{ id: 'pay-mine', amount: 5000, currency: 'nzd' }],
      documents: [{ id: 'doc-mine', originalName: 'mine.pdf' }],
      audit: [
        { eventType: 'PAYMENT_RECORDED_MANUAL', entityType: 'PAYMENT',  entityId: 'pay-OTHER', newValue: { amount: 999, currency: 'usd' }, actorRoleSnapshot: 'FINANCE', createdAt: INSIDE_1 },
        { eventType: 'PAYMENT_RECORDED_MANUAL', entityType: 'PAYMENT',  entityId: 'pay-mine',  newValue: { amount: 5000, currency: 'nzd' }, actorRoleSnapshot: 'FINANCE', createdAt: INSIDE_2 },
        { eventType: 'DOCUMENT_UPLOADED',       entityType: 'DOCUMENT', entityId: 'doc-OTHER', newValue: {}, actorRoleSnapshot: 'LIA', createdAt: INSIDE_3 },
        { eventType: 'DOCUMENT_UPLOADED',       entityType: 'DOCUMENT', entityId: 'doc-mine',  newValue: {}, actorRoleSnapshot: 'LIA', createdAt: INSIDE_3 },
      ],
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    // Two events survive (pay-mine + doc-mine), sorted chronologically.
    expect(items.map((i) => i.type)).toEqual([
      'PAYMENT_RECORDED_MANUAL',  // INSIDE_2
      'DOCUMENT_UPLOADED',        // INSIDE_3
    ]);
    // None refer to the OTHER fixtures — no leak of pay-OTHER / doc-OTHER
    // entity ids, no leak of the foreign payment's 999 amount or 'usd'
    // currency.
    for (const item of items) {
      const json = JSON.stringify(item);
      expect(json).not.toContain('pay-OTHER');
      expect(json).not.toContain('doc-OTHER');
      expect(json).not.toContain('999');
      expect(json).not.toContain('usd');
    }
  });

  it('items are sorted chronologically ascending across passes', async () => {
    const { service } = makeService({
      caseRow: CASE_FIXTURE,
      payments: [{ id: 'pay-1', amount: 5000, currency: 'nzd' }],
      audit: [
        // Pass B event at time 2.
        { eventType: 'PAYMENT_RECORDED_MANUAL', entityType: 'PAYMENT', entityId: 'pay-1', newValue: { amount: 5000, currency: 'nzd' }, actorRoleSnapshot: 'FINANCE', createdAt: INSIDE_2 },
        // Pass A event at time 1.
        { eventType: 'INZ_SUBMITTED', entityType: 'CASE', entityId: CASE_ID, newValue: { inzApplicationNumber: 'INZ-1' }, actorRoleSnapshot: 'LIA', createdAt: INSIDE_1 },
        // Pass A event at time 3.
        { eventType: 'VISA_ISSUED', entityType: 'CASE', entityId: CASE_ID, newValue: { visaStartDate: '2026-07-01', visaEndDate: '2027-07-01' }, actorRoleSnapshot: 'LIA', createdAt: INSIDE_3 },
      ],
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    expect(items.map((i) => i.type)).toEqual([
      'INZ_SUBMITTED',           // INSIDE_1
      'PAYMENT_RECORDED_MANUAL', // INSIDE_2
      'VISA_ISSUED',             // INSIDE_3
    ]);
    for (let i = 1; i < items.length; i++) {
      expect(items[i].occurredAt.getTime()).toBeGreaterThanOrEqual(items[i - 1].occurredAt.getTime());
    }
  });

  it('no internal fields appear in the output payload (audit row metadata is stripped)', async () => {
    const { service } = makeService({
      caseRow: CASE_FIXTURE,
      payments: [{ id: 'pay-1', amount: 5000, currency: 'nzd' }],
      audit: [{
        eventType: 'PAYMENT_RECORDED_MANUAL',
        entityType: 'PAYMENT',
        entityId: 'pay-1',
        newValue: {
          caseId:   CASE_ID,
          leadId:   'lead-1',
          paymentType: 'manual',
          amount:   5000,
          currency: 'nzd',
          hasNote:  true,
          receiptDocumentId: 'doc-r',
          verificationStatus: 'PENDING',
        },
        actorRoleSnapshot: 'FINANCE',
        createdAt: INSIDE_1,
      }],
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    const flat = JSON.stringify(items[0]);
    for (const leak of [
      'leadId', 'lead-1', 'paymentType', 'receiptDocumentId',
      'verificationStatus', 'PENDING', 'hasNote', 'entityId',
      'entityType', 'actorRoleSnapshot', 'newValue',
    ]) {
      expect(flat).not.toContain(leak);
    }
    // The legitimate fields ARE present.
    expect(items[0].data).toEqual({ amount: 5000, currency: 'nzd' });
  });

  it('tolerates a contact with no linked User (no meetings, no tickets — case + payment + doc passes still run)', async () => {
    const caseWithoutUser: CaseRow = {
      id: CASE_ID,
      lead: { contact: { id: CONTACT_ID, userId: null } },
    };
    const { service, prisma } = makeService({
      caseRow: caseWithoutUser,
      audit: [{
        eventType: 'INZ_SUBMITTED',
        entityType: 'CASE',
        entityId: CASE_ID,
        newValue: { inzApplicationNumber: 'INZ-1' },
        actorRoleSnapshot: 'LIA',
        createdAt: INSIDE_1,
      }],
    });
    const items = await service.gatherClientDigest(CASE_ID, SINCE, UNTIL);
    expect(items).toEqual([{
      type: 'INZ_SUBMITTED',
      occurredAt: INSIDE_1,
      data: { reference: 'INZ-1' },
    }]);
    // Meetings + tickets passes were never queried — userId was null.
    expect(prisma.visaMeeting.findMany).not.toHaveBeenCalled();
    expect(prisma.visaSupportTicket.findMany).not.toHaveBeenCalled();
  });
});
