import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { DeclarationAcceptanceService, requestOrigin } from './declaration-acceptance.service';
import { DECLARATION_VERSION, declarationText } from './declarations';

// PR-PHASE39 — what the audit row has to guarantee.
//
// The point of this table is that it can be trusted years later, so the tests
// are about the properties a lawyer would ask about: is the text the SERVER's
// (not the browser's), does a second agreement add a row rather than replace
// one, and does a failure here take the form down with it.

describe('DeclarationAcceptanceService', () => {
  let service: DeclarationAcceptanceService;
  let create: jest.Mock;

  beforeEach(async () => {
    create = jest.fn().mockResolvedValue({ id: 'pa-1' });
    const moduleRef = await Test.createTestingModule({
      providers: [
        DeclarationAcceptanceService,
        { provide: PrismaService, useValue: { policyAcceptance: { create } } },
      ],
    }).compile();
    service = moduleRef.get(DeclarationAcceptanceService);
  });

  it('snapshots the SERVER text, not anything supplied by the caller', async () => {
    await service.record({ userId: 'u1', type: 'ADMISSION_ACCEPTANCE', applicationId: 'app-1' });

    const { data } = create.mock.calls[0][0];
    expect(data.declarationText).toBe(declarationText('ADMISSION_ACCEPTANCE'));
    // The full text, not a version pointer — the row must stand alone.
    expect(data.declarationText).toContain('true, complete, and accurate');
    expect(data.declarationText.length).toBeGreaterThan(200);
    expect(data.policyVersion).toBe(DECLARATION_VERSION);
  });

  it('records who, what, when, from where, on what device', async () => {
    await service.record({
      userId: 'u1',
      type: 'AGENT_DECLARATION',
      applicationId: 'app-1',
      ipAddress: '203.0.113.9',
      userAgent: 'Mozilla/5.0',
    });

    const { data } = create.mock.calls[0][0];
    expect(data).toMatchObject({
      userId: 'u1',
      declarationType: 'AGENT_DECLARATION',
      applicationId: 'app-1',
      ipAddress: '203.0.113.9',
      userAgent: 'Mozilla/5.0',
    });
    // acceptedAt is the column default — never client-supplied.
    expect(data.acceptedAt).toBeUndefined();
  });

  it('APPENDS: agreeing twice writes two rows, never an update', async () => {
    await service.record({ userId: 'u1', type: 'VISA_SUBMIT_DECLARATION' });
    await service.record({ userId: 'u1', type: 'VISA_SUBMIT_DECLARATION' });

    expect(create).toHaveBeenCalledTimes(2);
    // The service exposes no update/delete path at all — proven by the mock
    // only ever needing `create`.
  });

  it('never lets an audit failure break the form that produced it', async () => {
    create.mockRejectedValueOnce(new Error('db down'));
    // A throw here would mean a client could not tick the box because we could
    // not log that they ticked it — losing more consent than it records.
    await expect(
      service.record({ userId: 'u1', type: 'ADMISSION_ACCEPTANCE' }),
    ).resolves.toBeUndefined();
  });
});

describe('requestOrigin', () => {
  it('takes the client hop from x-forwarded-for, not the proxy', () => {
    // Railway sits in front, so req.ip is the proxy; the first hop is the client.
    expect(requestOrigin({
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'UA' },
      ip: '10.0.0.1',
    })).toEqual({ ipAddress: '203.0.113.9', userAgent: 'UA' });
  });

  it('falls back to req.ip when unproxied, and nulls when nothing is known', () => {
    expect(requestOrigin({ headers: {}, ip: '198.51.100.4' }).ipAddress).toBe('198.51.100.4');
    expect(requestOrigin({})).toEqual({ ipAddress: null, userAgent: null });
  });
});
