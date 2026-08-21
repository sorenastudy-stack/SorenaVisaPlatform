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

function makeService(opts: {
  existingDraft?: { id: string } | null;
  trackingLink?: Record<string, unknown> | null;
  affiliateAgent?: Record<string, unknown> | null;
  existingAssessmentCompletedEvent?: { id: string } | null;
  scorecardSubmissionUpdateMany?: jest.Mock;
} = {}) {
  const userFindUnique = jest.fn().mockResolvedValue({
    id: 'user-1', role: 'LEAD', name: 'Test User', email: 'test@example.com',
  });
  const scorecardSubmissionFindFirst = jest.fn().mockResolvedValue(opts.existingDraft ?? null);
  const scorecardSubmissionCreate = jest.fn(async ({ data }: any) => ({ id: 'sub-new', ...data }));
  const scorecardSubmissionUpdate = jest.fn(async ({ data }: any) => ({ id: 'sub-existing', ...data }));
  const scorecardSubmissionUpdateMany = opts.scorecardSubmissionUpdateMany
    ?? jest.fn().mockResolvedValue({ count: 1 });
  const contactFindFirst = jest.fn().mockResolvedValue(null);
  const contactCreate = jest.fn().mockResolvedValue({ id: 'contact-1' });
  const leadCreate = jest.fn(async ({ data }: any) => ({ id: 'lead-1', ...data }));
  const userUpdate = jest.fn().mockResolvedValue({});
  const auditLogCreate = jest.fn().mockResolvedValue({ id: 'audit-1' });
  const trackingLinkFindUnique = jest.fn().mockResolvedValue(opts.trackingLink ?? null);
  const affiliateAgentFindUnique = jest.fn().mockResolvedValue(opts.affiliateAgent ?? null);
  const crmEventFindFirst = jest.fn().mockResolvedValue(opts.existingAssessmentCompletedEvent ?? null);
  const crmEventCreate = jest.fn().mockResolvedValue({ id: 'event-1' });

  const txDelegates = {
    scorecardSubmission: {
      findFirst: scorecardSubmissionFindFirst,
      create: scorecardSubmissionCreate,
      update: scorecardSubmissionUpdate,
      updateMany: scorecardSubmissionUpdateMany,
    },
    contact: { findFirst: contactFindFirst, create: contactCreate, update: jest.fn() },
    lead: { create: leadCreate },
    user: { update: userUpdate },
    auditLog: { create: auditLogCreate },
    crmEvent: { findFirst: crmEventFindFirst, create: crmEventCreate },
  };

  const prismaMock: any = {
    user: { findUnique: userFindUnique, findFirst: jest.fn() },
    scorecardSubmission: {
      findFirst: scorecardSubmissionFindFirst,
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
    scorecardSubmissionCreate, scorecardSubmissionUpdate, scorecardSubmissionUpdateMany,
    leadCreate, crmEventFindFirst, trackingLinkFindUnique, affiliateAgentFindUnique,
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
});
