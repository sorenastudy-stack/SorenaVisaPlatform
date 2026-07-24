/**
 * PR-CONTRACT-LEAD (Phase B) — scenario 5: the client-portal next-step during the
 * half-signed window.
 *
 * buildNextSteps must tell "you still need to sign" apart from "you've signed,
 * we're finishing internally", based on the CLIENT's OWN signer row — not the
 * whole-contract status (which stays SENT until every party signs).
 */

import { PortalService } from './portal.service';

function makeService(opts: { contractStatus: string; clientSigned: boolean }) {
  const prisma = {
    applicationDocument: { findMany: jest.fn(async () => []) },
    contract: {
      findUnique: jest.fn(async () => ({
        status: opts.contractStatus,
        signers: [{ signedAt: opts.clientSigned ? new Date('2026-07-23T10:00:00Z') : null }],
      })),
    },
    invoice: { findMany: jest.fn(async () => []) },
    case: { findUnique: jest.fn(async () => ({ lead: { id: 'lead-1', liaEscalationRequired: false } })) },
    consultation: { findFirst: jest.fn(async () => null) },
  } as any;
  return new PortalService(prisma, {} as any, {} as any);
}

function steps(service: PortalService) {
  return (service as any).buildNextSteps('case-1') as Promise<
    Array<{ kind: string; label: string; detail?: string | null }>
  >;
}

describe('PortalService buildNextSteps — Phase B half-signed window', () => {
  it('before the client signs: shows "Sign your engagement letter"', async () => {
    const s = await steps(makeService({ contractStatus: 'SENT', clientSigned: false }));
    const contract = s.find((x) => x.kind === 'CONTRACT');
    expect(contract).toBeDefined();
    expect(contract!.label).toMatch(/sign your engagement letter/i);
    expect(s.find((x) => x.kind === 'CONTRACT_PENDING_COUNTERSIGN')).toBeUndefined();
  });

  it('after the client signs (contract still SENT): shows the calm "case has started" message', async () => {
    const s = await steps(makeService({ contractStatus: 'SENT', clientSigned: true }));
    expect(s.find((x) => x.kind === 'CONTRACT')).toBeUndefined();
    const pending = s.find((x) => x.kind === 'CONTRACT_PENDING_COUNTERSIGN');
    expect(pending).toBeDefined();
    expect(pending!.label).toMatch(/your case has started/i);
    expect(pending!.detail).toMatch(/wrapping up the last few signatures/i);
  });

  it('once fully SIGNED: no contract step at all', async () => {
    const s = await steps(makeService({ contractStatus: 'SIGNED', clientSigned: true }));
    expect(s.find((x) => x.kind === 'CONTRACT')).toBeUndefined();
    expect(s.find((x) => x.kind === 'CONTRACT_PENDING_COUNTERSIGN')).toBeUndefined();
  });
});
