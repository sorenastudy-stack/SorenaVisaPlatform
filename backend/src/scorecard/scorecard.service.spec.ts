/**
 * PR-SCORECARD-ATTR-1 — unit/integration/regression/rollback-oriented tests
 * for the Scorecard UTM attribution + CRM-events work.
 *
 * Pattern matches src/payments/payments.service.spec.ts: hand-rolled prisma
 * mock (with a $transaction that just invokes the callback against a tx
 * mock built from the same jest.fn()s), direct `new ScorecardService(...)`
 * construction, no Nest boot, no DB.
 *
 * The scoring engine / routing / client-id modules are mocked so these
 * tests exercise ONLY the attribution + event-emission logic this PR adds
 * — not the (separately tested, in scoring.spec.ts) scoring engine itself.
 *
 * Covers:
 *   • resolveAttribution — UTM/landingPage pass-through (trim, null-
 *     coalesce), and that the PRE-EXISTING trackingLinkId/agentId/
 *     campaignLabel/channel resolution is completely unaffected
 *     (regression).
 *   • saveDraft — new-draft branch: persists UTM/landingPage, emits
 *     ASSESSMENT_STARTED exactly once, transactionally (tx client passed
 *     to events.emit), leadId null.
 *   • saveDraft — existing-draft branch: never emits ASSESSMENT_STARTED;
 *     first-attribution-wins bundle only overwrites when ALL FOUR columns
 *     are still null, and is skipped entirely when the draft already has
 *     attribution.
 *   • submitScorecard — persists UTM onto both the ScorecardSubmission row
 *     and the newly-created Lead; emits ASSESSMENT_COMPLETED exactly once,
 *     inside the same transaction as the Lead/submission writes.
 *   • submitScorecard — idempotency: when a CrmEvent for this submission id
 *     already exists (defensive re-entrancy guard), ASSESSMENT_COMPLETED is
 *     NOT re-emitted.
 *   • Rollback-oriented: with the 4 new DTO/service fields entirely absent
 *     from the request (older frontend build, pre-rollout), both saveDraft
 *     and submitScorecard behave exactly as they did before this PR —
 *     null UTM columns, no crash, no behavioural change to the untouched
 *     trackingLinkId/agentId/campaignId path.
 */

import { ScorecardService } from './scorecard.service';

// ─── Module mocks — isolate this PR's logic from the scoring engine ──────

jest.mock('./scoring/engine', () => ({
  score: jest.fn(),
}));
jest.mock('./scoring/routing', () => ({
  determineRouting: jest.fn(),
}));
jest.mock('../leads/client-id', () => ({
  generateClientId: jest.fn(),
}));

import { score } from './scoring/engine';
import { determineRouting } from './scoring/routing';
import { generateClientId } from '../leads/client-id';

const FAKE_SCORE_RESULT = {
  answers: { full_name: 'Test User' },
  perFieldScores: {
    q22_english_score: { answer: 'IELTS 7', points: 8 },
    q27_study_goal: { answer: 'Masters', points: 5 },
  },
  catScores: { 1: 10, 2: 15, 3: 12, 4: 8 },
  catScoresRaw: { 1: 10, 2: 15, 3: 12, 4: 8 },
  catMax: { 1: 25, 2: 25, 3: 25, 4: 25 },
  total: 45,
  band: { number: 3, enumValue: 'BAND_3', name: 'Developing', range: '40-54', route: '', service: '' },
  hardStops: [],
  riskFlags: [],
  execution: {
    eligible: true,
    gates: { 'Gate 1: something': true },
  },
};

const FAKE_ROUTING = {
  nextAction: 'BOOK_FREE_15MIN_SESSION',
  nextActionContent: { heading: 'h', bullets: ['b'] },
  nextActionTextEn: 'h b',
  nextActionTextFa: 'h b',
};

(score as jest.Mock).mockReturnValue(FAKE_SCORE_RESULT);
(determineRouting as jest.Mock).mockReturnValue(FAKE_ROUTING);
(generateClientId as jest.Mock).mockResolvedValue('NZ-2026-000001');

// ─── Helpers ────────────────────────────────────────────────────────────

interface DraftFixture {
  id: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  landingPage?: string | null;
}

interface LeadFixture {
  id: string;
  contactId: string;
  leadStatus: string;
  sourceChannel?: string | null;
  trackingLinkId?: string | null;
  attributedAgentId?: string | null;
  campaignId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  targetCountry?: string | null;
}

function makeService(opts: {
  existingDraft?: DraftFixture | null;
  scorecardSubmissionFindFirst?: jest.Mock;
  scorecardSubmissionFindMany?: jest.Mock;
  trackingLink?: Record<string, unknown> | null;
  affiliateAgent?: Record<string, unknown> | null;
  existingAssessmentCompletedEvent?: { id: string } | null;
  scorecardSubmissionUpdateMany?: jest.Mock;
  existingContact?: { id: string } | null;
  // PR-SCORECARD-ATTR-1 — the "Webinar already created this Lead" fixture.
  existingLead?: LeadFixture | null;
} = {}) {
  const userFindUnique = jest.fn().mockResolvedValue({
    id: 'user-1', role: 'LEAD', name: 'Test User', email: 'test@example.com',
  });
  const scorecardSubmissionFindFirst = opts.scorecardSubmissionFindFirst
    ?? jest.fn().mockResolvedValue(opts.existingDraft ?? null);
  const scorecardSubmissionFindMany = opts.scorecardSubmissionFindMany
    ?? jest.fn().mockResolvedValue([]);
  const scorecardSubmissionCreate = jest.fn(async ({ data }: any) => ({ id: 'sub-new', ...data }));
  const scorecardSubmissionUpdate = jest.fn(async ({ data }: any) => ({ id: 'sub-existing', ...data }));
  const scorecardSubmissionUpdateMany = opts.scorecardSubmissionUpdateMany
    ?? jest.fn().mockResolvedValue({ count: 1 });
  const contactFindFirst = jest.fn().mockResolvedValue(opts.existingContact ?? null);
  const contactCreate = jest.fn().mockResolvedValue({ id: 'contact-1' });
  const leadFindFirst = jest.fn().mockResolvedValue(opts.existingLead ?? null);
  const leadCreate = jest.fn(async ({ data }: any) => ({ id: 'lead-1', ...data }));
  const leadUpdate = jest.fn(async ({ data }: any) => ({
    id: opts.existingLead?.id ?? 'lead-1', ...opts.existingLead, ...data,
  }));
  const userUpdate = jest.fn().mockResolvedValue({});
  const auditLogCreate = jest.fn().mockResolvedValue({ id: 'audit-1' });
  const trackingLinkFindUnique = jest.fn().mockResolvedValue(opts.trackingLink ?? null);
  const affiliateAgentFindUnique = jest.fn().mockResolvedValue(opts.affiliateAgent ?? null);
  const crmEventFindFirst = jest.fn().mockResolvedValue(opts.existingAssessmentCompletedEvent ?? null);
  const crmEventCreate = jest.fn().mockResolvedValue({ id: 'event-1' });

  const txDelegates = {
    scorecardSubmission: {
      findFirst: scorecardSubmissionFindFirst,
      findMany: scorecardSubmissionFindMany,
      create: scorecardSubmissionCreate,
      update: scorecardSubmissionUpdate,
      updateMany: scorecardSubmissionUpdateMany,
    },
    contact: { findFirst: contactFindFirst, create: contactCreate, update: jest.fn() },
    lead: { findFirst: leadFindFirst, create: leadCreate, update: leadUpdate },
    user: { update: userUpdate },
    auditLog: { create: auditLogCreate },
    crmEvent: { findFirst: crmEventFindFirst, create: crmEventCreate },
  };

  const prismaMock: any = {
    user: { findUnique: userFindUnique, findFirst: jest.fn() },
    scorecardSubmission: {
      findFirst: scorecardSubmissionFindFirst,
      findMany: scorecardSubmissionFindMany,
      create: scorecardSubmissionCreate,
      update: scorecardSubmissionUpdate,
      updateMany: scorecardSubmissionUpdateMany,
    },
    trackingLink: { findUnique: trackingLinkFindUnique },
    affiliateAgent: { findUnique: affiliateAgentFindUnique },
    crmEvent: { findFirst: crmEventFindFirst, create: crmEventCreate },
    $transaction: jest.fn(async (cb: any) => cb(txDelegates)),
  };

  const cryptoMock: any = {
    encrypt: jest.fn((s: string) => Buffer.from(s)),
    decrypt: jest.fn((b: Buffer) => b.toString()),
  };
  const magicLinkMock: any = { requestLink: jest.fn() };
  const passwordSetupMock: any = { requestSetup: jest.fn() };
  const eventsMock: any = { emit: jest.fn().mockResolvedValue({ id: 'event-1' }) };

  const service = new ScorecardService(
    prismaMock, cryptoMock, magicLinkMock, passwordSetupMock, eventsMock,
  );

  return {
    service, prisma: prismaMock, events: eventsMock,
    scorecardSubmissionFindFirst, scorecardSubmissionFindMany,
    scorecardSubmissionCreate, scorecardSubmissionUpdate, scorecardSubmissionUpdateMany,
    contactFindFirst, contactCreate, leadCreate, leadFindFirst, leadUpdate, auditLogCreate,
    crmEventFindFirst, trackingLinkFindUnique, affiliateAgentFindUnique,
  };
}

const ACTOR = { userId: 'user-1', name: 'Test User', role: 'LEAD' };

// ─── resolveAttribution ────────────────────────────────────────────────

describe('ScorecardService — resolveAttribution (private)', () => {
  it('passes UTM/landingPage through verbatim (trimmed), independent of trackingLinkId/agentId', async () => {
    const { service, trackingLinkFindUnique, affiliateAgentFindUnique } = makeService();
    const result = await (service as any).resolveAttribution({
      utmSource: '  google  ',
      utmMedium: 'cpc',
      utmCampaign: 'nz-2026-q3',
      landingPage: '/malaysia',
    });
    expect(result.utmSource).toBe('google');
    expect(result.utmMedium).toBe('cpc');
    expect(result.utmCampaign).toBe('nz-2026-q3');
    expect(result.landingPage).toBe('/malaysia');
    // No trackingLinkId/agentId supplied → neither lookup fires. Regression
    // guard: UTM handling must not trigger the unrelated DB lookups.
    expect(trackingLinkFindUnique).not.toHaveBeenCalled();
    expect(affiliateAgentFindUnique).not.toHaveBeenCalled();
  });

  it('empty-string / missing UTM fields resolve to null, not empty string', async () => {
    const { service } = makeService();
    const result = await (service as any).resolveAttribution({ utmSource: '   ' });
    expect(result.utmSource).toBeNull();
    expect(result.utmMedium).toBeNull();
    expect(result.utmCampaign).toBeNull();
    expect(result.landingPage).toBeNull();
  });

  it('REGRESSION: trackingLinkId resolution is unchanged by the UTM fields being present', async () => {
    const { service } = makeService({
      trackingLink: { id: 'tl-1', status: 'ACTIVE', agentId: 'agent-9', campaignLabel: 'spring', channel: 'INSTAGRAM' },
    });
    const result = await (service as any).resolveAttribution({
      trackingLinkId: 'tl-1',
      utmSource: 'google', // present simultaneously — must not interfere
    });
    expect(result.trackingLinkId).toBe('tl-1');
    expect(result.agentId).toBe('agent-9');
    expect(result.campaignLabel).toBe('spring');
    expect(result.sourceChannel).toBe('SCORECARD_INSTAGRAM');
    expect(result.utmSource).toBe('google');
  });
});

// ─── saveDraft ──────────────────────────────────────────────────────────

describe('ScorecardService — saveDraft', () => {
  it('new draft: persists UTM/landingPage and emits ASSESSMENT_STARTED once, transactionally, with leadId null', async () => {
    const { service, events, scorecardSubmissionCreate } = makeService({ existingDraft: null });

    const out = await service.saveDraft('user-1', { full_name: 'Test' }, {
      utmSource: 'meta', utmMedium: 'paid-social', utmCampaign: 'launch', landingPage: '/nz',
    });

    expect(scorecardSubmissionCreate).toHaveBeenCalledTimes(1);
    const createData = scorecardSubmissionCreate.mock.calls[0][0].data;
    expect(createData.utmSource).toBe('meta');
    expect(createData.utmMedium).toBe('paid-social');
    expect(createData.utmCampaign).toBe('launch');
    expect(createData.landingPage).toBe('/nz');
    expect(createData.isDraft).toBe(true);

    expect(events.emit).toHaveBeenCalledTimes(1);
    const [eventType, entityType, entityId, leadId, triggerSource, actorId, , txClient] =
      events.emit.mock.calls[0];
    expect(eventType).toBe('ASSESSMENT_STARTED');
    expect(entityType).toBe('SCORECARD_SUBMISSION');
    expect(entityId).toBe(out.id);
    expect(leadId).toBeNull();
    expect(triggerSource).toBe('SYSTEM');
    expect(actorId).toBe('user-1');
    expect(txClient).toBeDefined(); // transactional — not the top-level prisma
  });

  it('new draft with NO attribution supplied: still creates (rollback-oriented — behaves as pre-PR code), UTM columns null, event still fires', async () => {
    const { service, events, scorecardSubmissionCreate } = makeService({ existingDraft: null });
    await service.saveDraft('user-1', { full_name: 'Test' }); // attribution omitted entirely
    const createData = scorecardSubmissionCreate.mock.calls[0][0].data;
    expect(createData.utmSource).toBeNull();
    expect(createData.utmMedium).toBeNull();
    expect(createData.utmCampaign).toBeNull();
    expect(createData.landingPage).toBeNull();
    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit.mock.calls[0][0]).toBe('ASSESSMENT_STARTED');
  });

  it('existing draft: never re-emits ASSESSMENT_STARTED', async () => {
    const { service, events } = makeService({ existingDraft: { id: 'sub-existing' } });
    await service.saveDraft('user-1', { full_name: 'Test 2' }, { utmSource: 'google' });
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('existing draft, first attribution for this draft: updateMany fires with the all-four-null guard', async () => {
    const { service, scorecardSubmissionUpdateMany } = makeService({ existingDraft: { id: 'sub-existing' } });
    await service.saveDraft('user-1', { full_name: 'Test 2' }, {
      utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'c1', landingPage: '/nz',
    });
    expect(scorecardSubmissionUpdateMany).toHaveBeenCalledTimes(1);
    const call = scorecardSubmissionUpdateMany.mock.calls[0][0];
    expect(call.where).toEqual({
      id: 'sub-existing', utmSource: null, utmMedium: null, utmCampaign: null, landingPage: null,
    });
    expect(call.data).toEqual({ utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'c1', landingPage: '/nz' });
  });

  it('existing draft, no attribution on this autosave: updateMany is skipped entirely (no wasted write)', async () => {
    const { service, scorecardSubmissionUpdateMany } = makeService({ existingDraft: { id: 'sub-existing' } });
    await service.saveDraft('user-1', { full_name: 'Test 2' }); // no attribution
    expect(scorecardSubmissionUpdateMany).not.toHaveBeenCalled();
  });
});

// ─── submitScorecard ────────────────────────────────────────────────────

describe('ScorecardService — submitScorecard', () => {
  it('persists UTM onto BOTH the submission row and the new Lead, and emits ASSESSMENT_COMPLETED once inside the transaction', async () => {
    const { service, events, scorecardSubmissionCreate, leadCreate } = makeService({ existingDraft: null });

    await service.submitScorecard(
      'user-1',
      { full_name: 'Test User', email: 'test@example.com' },
      { ipAddress: '1.2.3.4', userAgent: 'jest' },
      ACTOR,
      { utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'launch', landingPage: '/nz' },
    );

    const submissionData = scorecardSubmissionCreate.mock.calls[0][0].data;
    expect(submissionData.utmSource).toBe('google');
    expect(submissionData.utmMedium).toBe('cpc');
    expect(submissionData.utmCampaign).toBe('launch');
    expect(submissionData.landingPage).toBe('/nz');

    const leadData = leadCreate.mock.calls[0][0].data;
    expect(leadData.utmSource).toBe('google');
    expect(leadData.utmMedium).toBe('cpc');
    expect(leadData.utmCampaign).toBe('launch');
    // Lead has no landingPage column — must NOT be set on the Lead payload.
    expect(leadData.landingPage).toBeUndefined();

    const completedCalls = events.emit.mock.calls.filter((c: any[]) => c[0] === 'ASSESSMENT_COMPLETED');
    expect(completedCalls).toHaveLength(1);
    const [, entityType, entityId, leadId, triggerSource, actorId, , txClient] = completedCalls[0];
    expect(entityType).toBe('SCORECARD_SUBMISSION');
    expect(entityId).toBe('sub-new');
    expect(leadId).toBe('lead-1');
    expect(triggerSource).toBe('SYSTEM');
    expect(actorId).toBe('user-1');
    expect(txClient).toBeDefined();
  });

  it('IDEMPOTENCY: does not re-emit ASSESSMENT_COMPLETED when a CrmEvent for this submission already exists', async () => {
    const { service, events } = makeService({
      existingDraft: null,
      existingAssessmentCompletedEvent: { id: 'already-there' },
    });

    await service.submitScorecard(
      'user-1',
      { full_name: 'Test User', email: 'test@example.com' },
      {},
      ACTOR,
      { utmSource: 'google' },
    );

    const completedCalls = events.emit.mock.calls.filter((c: any[]) => c[0] === 'ASSESSMENT_COMPLETED');
    expect(completedCalls).toHaveLength(0);
  });

  it('ROLLBACK-ORIENTED: with attribution entirely omitted (pre-PR call shape), submit still succeeds — UTM columns null, Lead trackingLinkId/agentId/campaignId path untouched', async () => {
    const { service, scorecardSubmissionCreate, leadCreate } = makeService({
      existingDraft: null,
      trackingLink: { id: 'tl-1', status: 'ACTIVE', agentId: 'agent-9', campaignLabel: 'spring', channel: 'INSTAGRAM' },
    });

    await service.submitScorecard(
      'user-1',
      { full_name: 'Test User', email: 'test@example.com' },
      {},
      ACTOR,
      { trackingLinkId: 'tl-1' }, // legacy-shaped attribution, no UTM fields at all
    );

    const submissionData = scorecardSubmissionCreate.mock.calls[0][0].data;
    expect(submissionData.utmSource).toBeNull();
    expect(submissionData.utmMedium).toBeNull();
    expect(submissionData.utmCampaign).toBeNull();
    expect(submissionData.landingPage).toBeNull();

    const leadData = leadCreate.mock.calls[0][0].data;
    // Pre-existing mechanism completely unaffected.
    expect(leadData.trackingLinkId).toBe('tl-1');
    expect(leadData.attributedAgentId).toBe('agent-9');
    expect(leadData.campaignId).toBe('spring');
    expect(leadData.utmSource).toBeNull();
    expect(leadData.utmMedium).toBeNull();
    expect(leadData.utmCampaign).toBeNull();
  });

  // ─── PR-SCORECARD-ATTR-1: Lead reuse across Webinar → Scorecard ───────

  it('REGRESSION: Webinar registration → existing Contact/Lead → Scorecard submission → same Lead reused → no duplicate Lead', async () => {
    const webinarLead: LeadFixture = {
      id: 'lead-from-webinar',
      contactId: 'contact-1',
      leadStatus: 'NEW',
      sourceChannel: 'WEBSITE_WEBINAR',
      trackingLinkId: null,
      attributedAgentId: null,
      campaignId: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      targetCountry: null,
    };
    const { service, leadCreate, leadUpdate, leadFindFirst } = makeService({
      existingDraft: null,
      existingContact: { id: 'contact-1' },
      existingLead: webinarLead,
    });

    const payload = await service.submitScorecard(
      'user-1',
      { full_name: 'Test User', email: 'test@example.com' },
      {},
      ACTOR,
      { utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'launch' },
    );

    // The defining assertion: no second Lead was created.
    expect(leadCreate).not.toHaveBeenCalled();
    expect(leadFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contactId: 'contact-1' } }),
    );
    expect(leadUpdate).toHaveBeenCalledTimes(1);
    expect(leadUpdate.mock.calls[0][0].where).toEqual({ id: 'lead-from-webinar' });

    const updateData = leadUpdate.mock.calls[0][0].data;
    // Pre-scoring status → advances to SCORING_DONE.
    expect(updateData.leadStatus).toBe('SCORING_DONE');
    // sourceChannel must NOT be present in the update payload — the Lead's
    // original provenance (how it first entered the pipeline) is preserved.
    expect(updateData.sourceChannel).toBeUndefined();
    // First-attribution-wins: the webinar Lead had none yet, so THIS
    // submit's UTM fills it.
    expect(updateData.utmSource).toBe('google');
    expect(updateData.utmMedium).toBe('cpc');
    expect(updateData.utmCampaign).toBe('launch');
    expect(updateData.firstTouchSource).toBe('google');
    expect(updateData.lastTouchSource).toBe('google');
    // Scores always reflect the latest attempt.
    expect(updateData.readinessScore).toBe(FAKE_SCORE_RESULT.total);

    expect(payload.leadId).toBe('lead-from-webinar');
  });

  it('REPEAT SUBMISSION: creates a new attempt and links it to the same canonical Lead', async () => {
    const { service, scorecardSubmissionCreate, scorecardSubmissionUpdate, leadCreate, leadUpdate } = makeService({
      existingDraft: null,
      existingContact: { id: 'contact-1' },
      existingLead: {
        id: 'lead-existing',
        contactId: 'contact-1',
        leadStatus: 'SCORING_DONE',
        sourceChannel: 'SCORECARD',
      },
    });

    const payload = await service.submitScorecard(
      'user-1',
      { full_name: 'Test User', email: 'test@example.com' },
      {},
      ACTOR,
    );

    expect(scorecardSubmissionCreate).toHaveBeenCalledTimes(1);
    expect(leadCreate).not.toHaveBeenCalled();
    expect(leadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'lead-existing' },
    }));
    expect(scorecardSubmissionUpdate).toHaveBeenCalledWith({
      where: { id: 'sub-new' },
      data: { leadId: 'lead-existing' },
    });
    expect(payload.submissionId).toBe('sub-new');
    expect(payload.leadId).toBe('lead-existing');
  });

  it('normalises the Scorecard email and matches an existing Webinar Contact case-insensitively', async () => {
    const { service, contactFindFirst, contactCreate, leadCreate } = makeService({
      existingContact: { id: 'contact-1' },
      existingLead: {
        id: 'lead-from-webinar',
        contactId: 'contact-1',
        leadStatus: 'NEW',
      },
    });

    await service.submitScorecard(
      'user-1',
      { full_name: 'Test User', email: '  Test@Example.COM  ' },
      {},
      ACTOR,
    );

    expect(contactFindFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: 'test@example.com', mode: 'insensitive' },
      },
    });
    expect(contactCreate).not.toHaveBeenCalled();
    expect(leadCreate).not.toHaveBeenCalled();
  });

  it('does not regress leadStatus for a Lead that already progressed past scoring (e.g. QUALIFIED)', async () => {
    const advancedLead: LeadFixture = {
      id: 'lead-advanced', contactId: 'contact-1', leadStatus: 'QUALIFIED',
    };
    const { service, leadUpdate } = makeService({
      existingDraft: null,
      existingContact: { id: 'contact-1' },
      existingLead: advancedLead,
    });

    await service.submitScorecard(
      'user-1',
      { full_name: 'Test User', email: 'test@example.com' },
      {},
      ACTOR,
    );

    expect(leadUpdate.mock.calls[0][0].data.leadStatus).toBe('QUALIFIED');
  });

  it('reused Lead: first-attribution-wins preserves the Lead\'s existing trackingLinkId/attributedAgentId/campaignId — never overwritten by a later submit', async () => {
    const attributedLead: LeadFixture = {
      id: 'lead-attributed', contactId: 'contact-1', leadStatus: 'NEW',
      trackingLinkId: 'original-tl', attributedAgentId: 'original-agent', campaignId: 'original-campaign',
    };
    const { service, leadUpdate } = makeService({
      existingDraft: null,
      existingContact: { id: 'contact-1' },
      existingLead: attributedLead,
      trackingLink: { id: 'tl-new', status: 'ACTIVE', agentId: 'agent-new', campaignLabel: 'new-campaign', channel: 'FACEBOOK' },
    });

    await service.submitScorecard(
      'user-1',
      { full_name: 'Test User', email: 'test@example.com' },
      {},
      ACTOR,
      { trackingLinkId: 'tl-new' },
    );

    const data = leadUpdate.mock.calls[0][0].data;
    expect(data.trackingLinkId).toBe('original-tl');
    expect(data.attributedAgentId).toBe('original-agent');
    expect(data.campaignId).toBe('original-campaign');
  });

  it('audits a reused Lead as SCORECARD_LEAD_REUSED (action UPDATE), not SCORECARD_LEAD_CREATED', async () => {
    const { service, auditLogCreate } = makeService({
      existingDraft: null,
      existingContact: { id: 'contact-1' },
      existingLead: { id: 'lead-from-webinar', contactId: 'contact-1', leadStatus: 'NEW' },
    });

    await service.submitScorecard(
      'user-1',
      { full_name: 'Test User', email: 'test@example.com' },
      {},
      ACTOR,
    );

    const leadAuditCall = auditLogCreate.mock.calls.find(
      (c: any[]) => c[0].data.entityType === 'LEAD',
    );
    expect(leadAuditCall[0].data.eventType).toBe('SCORECARD_LEAD_REUSED');
    expect(leadAuditCall[0].data.action).toBe('UPDATE');
  });

  // ─── PR-SCORECARD-ATTR-1: first-touch preservation through submit ─────

  it('FIRST-TOUCH PRESERVATION: draft already captured UTM; final submit carries none → the draft\'s stored attribution wins, not lost', async () => {
    const { service, scorecardSubmissionUpdate, leadCreate } = makeService({
      existingDraft: {
        id: 'draft-1', utmSource: 'meta', utmMedium: 'paid-social', utmCampaign: 'first-touch', landingPage: '/nz',
      },
    });

    await service.submitScorecard(
      'user-1',
      { full_name: 'Test User', email: 'test@example.com' },
      {},
      ACTOR,
      {}, // submit request carries NO attribution at all
    );

    const submissionData = scorecardSubmissionUpdate.mock.calls[0][0].data;
    expect(submissionData.utmSource).toBe('meta');
    expect(submissionData.utmMedium).toBe('paid-social');
    expect(submissionData.utmCampaign).toBe('first-touch');
    expect(submissionData.landingPage).toBe('/nz');

    const leadData = leadCreate.mock.calls[0][0].data;
    expect(leadData.utmSource).toBe('meta');
    expect(leadData.utmMedium).toBe('paid-social');
    expect(leadData.utmCampaign).toBe('first-touch');
    expect(leadData.firstTouchSource).toBe('meta');
    expect(leadData.lastTouchSource).toBe('meta');
  });

  it('FIRST-TOUCH PRESERVATION: draft\'s stored attribution wins even when the final submit carries a DIFFERENT value (not just none)', async () => {
    const { service, scorecardSubmissionUpdate } = makeService({
      existingDraft: {
        id: 'draft-1', utmSource: 'meta', utmMedium: 'paid-social', utmCampaign: 'first-touch', landingPage: null,
      },
    });

    await service.submitScorecard(
      'user-1',
      { full_name: 'Test User', email: 'test@example.com' },
      {},
      ACTOR,
      { utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'later-touch' }, // a DIFFERENT campaign at submit time
    );

    const submissionData = scorecardSubmissionUpdate.mock.calls[0][0].data;
    // The draft's original bundle wins in full — not a per-field mix.
    expect(submissionData.utmSource).toBe('meta');
    expect(submissionData.utmMedium).toBe('paid-social');
    expect(submissionData.utmCampaign).toBe('first-touch');
  });

  it('no first-touch bundle on the draft → falls through to whatever the submit request carries (normal case)', async () => {
    const { service, scorecardSubmissionUpdate } = makeService({
      existingDraft: { id: 'draft-1', utmSource: null, utmMedium: null, utmCampaign: null, landingPage: null },
    });

    await service.submitScorecard(
      'user-1',
      { full_name: 'Test User', email: 'test@example.com' },
      {},
      ACTOR,
      { utmSource: 'google' },
    );

    expect(scorecardSubmissionUpdate.mock.calls[0][0].data.utmSource).toBe('google');
  });
});

// ─── PR-SCORECARD-SUBMIT-RACE-FIX ──────────────────────────────────────────
//
// The race PR-SCORECARD-ATTR-1's Lead reuse made reachable: two submits for
// one contact resolve to the SAME Lead, each creates its own submission row,
// and `ScorecardSubmission.leadId` is @unique — so the second loses and used
// to reach the visitor as "An unexpected error occurred", for a submission
// that had already succeeded.
//
// These tests exist mostly to hold the BLAST RADIUS down. Recovering from an
// error is one line away from swallowing errors that deserve to be seen, so
// three of the five assert that something still throws.

describe('ScorecardService.submitScorecard — concurrent-submit race recovery', () => {
  const ANSWERS = { full_name: 'Test User', email: 'test@example.com' };
  const leadIdRace = () =>
    Object.assign(new Error('Unique constraint failed on the fields: (`leadId`)'), {
      code: 'P2002',
      meta: { target: ['leadId'] },
    });

  const submit = (service: any) =>
    service.submitScorecard('user-1', ANSWERS, {}, ACTOR, {});

  it('returns the submission that already committed, instead of crashing', async () => {
    const { service, prisma } = makeService({ existingDraft: null });
    const committed = {
      id: 'sub-already-committed',
      leadId: 'lead-already-committed',
      submittedAt: new Date('2026-08-21T05:09:19.000Z'),
      consultationBookedAt: null,
    };
    prisma.$transaction = jest.fn().mockRejectedValue(leadIdRace());
    // findFirst is shared between the pre-transaction draft check and the
    // recovery lookup, so the two calls are sequenced rather than stubbed once.
    prisma.scorecardSubmission.findFirst
      .mockReset()
      .mockResolvedValueOnce(null)        // draft check
      .mockResolvedValueOnce(committed);  // recovery lookup

    const payload = await submit(service);

    // The visitor's real submission — not a fabricated new one.
    expect(payload.submissionId).toBe('sub-already-committed');
    expect(payload.leadId).toBe('lead-already-committed');
    expect(prisma.scorecardSubmission.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.scorecardSubmission.findFirst.mock.calls[1][0]).toMatchObject({
      where: { userId: 'user-1', isDraft: false },   // a real submission, not a draft
      orderBy: { submittedAt: 'desc' },              // the most recent one
    });
  });

  it('rethrows when there is no committed submission to stand in for', async () => {
    // Nothing succeeded, so there is nothing to recover — reporting success
    // here would lose the submission silently.
    const { service, prisma } = makeService({ existingDraft: null });
    const race = leadIdRace();
    prisma.$transaction = jest.fn().mockRejectedValue(race);
    prisma.scorecardSubmission.findFirst
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await expect(submit(service)).rejects.toBe(race);
  });

  it('rethrows a P2002 on a different column — the match is on leadId, not on "duplicate"', async () => {
    const { service, prisma } = makeService({ existingDraft: null });
    const other = Object.assign(new Error('Unique constraint failed on the fields: (`email`)'), {
      code: 'P2002',
      meta: { target: ['email'] },
    });
    prisma.$transaction = jest.fn().mockRejectedValue(other);

    await expect(submit(service)).rejects.toBe(other);
    // Not even looked for a recovery — only the pre-transaction draft check ran.
    expect(prisma.scorecardSubmission.findFirst).toHaveBeenCalledTimes(1);
  });

  it('rethrows an unrelated failure such as the database going away', async () => {
    const { service, prisma } = makeService({ existingDraft: null });
    const outage = new Error('Connection terminated unexpectedly');
    prisma.$transaction = jest.fn().mockRejectedValue(outage);

    await expect(submit(service)).rejects.toBe(outage);
    expect(prisma.scorecardSubmission.findFirst).toHaveBeenCalledTimes(1);
  });

  it('leaves an ordinary submit completely untouched', async () => {
    const { service, prisma, scorecardSubmissionCreate, leadCreate } =
      makeService({ existingDraft: null });

    const payload = await submit(service);

    expect(payload.submissionId).toBe('sub-new');
    expect(payload.leadId).toBe('lead-1');
    expect(scorecardSubmissionCreate).toHaveBeenCalledTimes(1);
    expect(leadCreate).toHaveBeenCalledTimes(1);
    // The recovery path was never entered, because nothing threw.
    expect(prisma.scorecardSubmission.findFirst).toHaveBeenCalledTimes(1);
    // Previously hardcoded null; now sourced from the row, and must not have
    // become undefined in the process.
    expect(payload.consultationBookedAt).toBeNull();
  });
});

describe('ScorecardService — returning-user reads', () => {
  it('latest result excludes open drafts', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const { service } = makeService({ scorecardSubmissionFindFirst: findFirst });

    await expect(service.getMyLatestResult('user-1')).rejects.toThrow(
      'No scorecard submissions for this user yet.',
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', isDraft: false },
      orderBy: { submittedAt: 'desc' },
    });
  });

  it('history excludes open drafts', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { service } = makeService({ scorecardSubmissionFindMany: findMany });

    await expect(service.getMyHistory('user-1')).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isDraft: false },
      orderBy: { submittedAt: 'desc' },
    });
  });

  it('returns a PII-free state summary for the entry page', async () => {
    const findFirst = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'sub-complete',
        submittedAt: new Date('2026-08-21T05:26:38.804Z'),
      });
    const { service } = makeService({ scorecardSubmissionFindFirst: findFirst });

    await expect(service.getMyState('user-1')).resolves.toEqual({
      hasDraft: false,
      draftId: null,
      hasCompleted: true,
      latestCompletedSubmissionId: 'sub-complete',
      latestCompletedAt: '2026-08-21T05:26:38.804Z',
    });
    expect(findFirst.mock.calls).toEqual([
      [{
        where: { userId: 'user-1', isDraft: true },
        orderBy: { submittedAt: 'desc' },
        select: { id: true },
      }],
      [{
        where: { userId: 'user-1', isDraft: false },
        orderBy: { submittedAt: 'desc' },
        select: { id: true, submittedAt: true },
      }],
    ]);
  });
});
