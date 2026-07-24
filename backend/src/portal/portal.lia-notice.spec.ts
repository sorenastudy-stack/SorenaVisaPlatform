/**
 * PR-CONTRACT-GATE (Phase A) — client-portal LIA-review notice.
 *
 * Scenario 5 from the brief: the portal "next steps" list must surface a calm
 * LIA_REVIEW notice while a red-flagged case is awaiting a licensed adviser,
 * and that notice must disappear the moment an LIA records an APPROVED verdict
 * (the same signal that unlocks contract sending). A non-flagged case never
 * shows it.
 *
 * buildNextSteps is private and fans out several queries; we mock only the
 * models it reads and assert the presence/absence of the LIA_REVIEW step.
 */

import { PortalService } from './portal.service';

// Build a PortalService whose prisma returns "nothing else to do" for docs /
// contract / invoices, and drives the red-flag + LIA-verdict state via
// case.findUnique + consultation.findFirst.
function makeService(opts: {
  liaEscalationRequired: boolean;
  liaApproved?: boolean; // an APPROVED LIA consultation exists
}) {
  const consultationFindFirst = jest.fn(async () =>
    opts.liaApproved ? { id: 'lia-consult-approved' } : null,
  );
  const prisma = {
    applicationDocument: { findMany: jest.fn(async () => []) },
    contract: { findUnique: jest.fn(async () => null) },
    invoice: { findMany: jest.fn(async () => []) },
    case: {
      findUnique: jest.fn(async () => ({
        lead: { id: 'lead-1', liaEscalationRequired: opts.liaEscalationRequired },
      })),
    },
    consultation: { findFirst: consultationFindFirst },
  } as any;

  const service = new PortalService(prisma, {} as any, {} as any);
  return { service, consultationFindFirst };
}

function buildSteps(service: PortalService) {
  return (service as any).buildNextSteps('case-1') as Promise<
    Array<{ kind: string; label: string; detail?: string | null }>
  >;
}

describe('PortalService LIA-review notice (Phase A)', () => {
  it('scenario 5: red-flagged + unresolved → shows the LIA_REVIEW notice', async () => {
    const { service } = makeService({ liaEscalationRequired: true, liaApproved: false });
    const steps = await buildSteps(service);
    const notice = steps.find((s) => s.kind === 'LIA_REVIEW');
    expect(notice).toBeDefined();
    // Calm, reassuring, and NEVER surfaces the internal hard-stop reasoning.
    expect(notice!.label).toMatch(/review needed/i);
    expect(notice!.detail).toMatch(/licensed immigration adviser/i);
    expect(JSON.stringify(notice)).not.toMatch(/HS4|hard stop|escalation/i);
  });

  it('scenario 5: red-flagged but LIA APPROVED → notice is gone', async () => {
    const { service } = makeService({ liaEscalationRequired: true, liaApproved: true });
    const steps = await buildSteps(service);
    expect(steps.find((s) => s.kind === 'LIA_REVIEW')).toBeUndefined();
  });

  it('non-flagged case never shows the notice (and skips the verdict query)', async () => {
    const { service, consultationFindFirst } = makeService({ liaEscalationRequired: false });
    const steps = await buildSteps(service);
    expect(steps.find((s) => s.kind === 'LIA_REVIEW')).toBeUndefined();
    expect(consultationFindFirst).not.toHaveBeenCalled();
  });
});
