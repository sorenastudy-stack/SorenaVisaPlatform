/**
 * PR-CONTRACT-GATE (Phase A) — unit spec for the contract-send precondition
 * (ContractsService.assertContractSendAllowed).
 *
 * This is the single gate every send path (DocuSign + DocuSeal, every caller)
 * runs through inside prepareEngagementSend. We test the decision logic in
 * isolation with a mocked Prisma — no DB, no provider dispatch — because the
 * scenarios are entirely about *which consultation state locks vs unlocks the
 * send*, not about envelope mechanics (those are covered by the webhook spec).
 *
 * Scenario coverage (from the Phase-A brief):
 *   1. No red flag + COMPLETED FREE_15         → allowed  (normal send / regression)
 *   2. No red flag + no COMPLETED FREE_15       → blocked  (free-consult message)
 *   3. Red-flagged + FREE_15 done, no LIA verdict → blocked (flagged-concern lock)
 *   4. Red-flagged + FREE_15 done + LIA APPROVED  → allowed (unlock)
 *      …and each non-APPROVED verdict keeps it locked with its own message.
 */

import { UnprocessableEntityException } from '@nestjs/common';
import { ConsultationType, LegalDecision } from '@prisma/client';
import { ContractsService } from './contracts.service';

// A tiny Prisma stand-in exposing only what the gate reads:
// consultation.findFirst, dispatched by the `type` in the where-clause.
function makeService(opts: {
  free15Completed: boolean;
  liaVerdict?: LegalDecision | null; // undefined/null = no recorded LIA verdict
}) {
  const findFirst = jest.fn(async (args: any) => {
    const type = args?.where?.type;
    if (type === ConsultationType.FREE_15) {
      return opts.free15Completed ? { id: 'free15-1' } : null;
    }
    if (type === ConsultationType.LIA) {
      // The gate filters on decision: { not: null }; a missing verdict → no row.
      return opts.liaVerdict ? { decision: opts.liaVerdict } : null;
    }
    return null;
  });

  const prisma = { consultation: { findFirst } } as any;
  // Only prisma is touched by the gate; the rest are never called here.
  const service = new ContractsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { service, findFirst };
}

// The private method is the unit under test — reach it explicitly.
function callGate(service: ContractsService, lead: { id: string; liaEscalationRequired: boolean }) {
  return (service as any).assertContractSendAllowed(lead) as Promise<void>;
}

describe('ContractsService.assertContractSendAllowed (Phase A gate)', () => {
  // ── Scenario 1 — clean path, no red flag ────────────────────────────────
  it('scenario 1: no red flag + COMPLETED FREE_15 → allowed (does not throw)', async () => {
    const { service, findFirst } = makeService({ free15Completed: true });
    await expect(callGate(service, { id: 'lead-1', liaEscalationRequired: false })).resolves.toBeUndefined();
    // Only the FREE_15 check runs — a non-flagged lead never queries the LIA verdict.
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  // ── Scenario 2 — free consult not completed ─────────────────────────────
  it('scenario 2: no red flag + no COMPLETED FREE_15 → blocked', async () => {
    const { service } = makeService({ free15Completed: false });
    await expect(callGate(service, { id: 'lead-2', liaEscalationRequired: false })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(callGate(service, { id: 'lead-2', liaEscalationRequired: false })).rejects.toThrow(
      /free 15-minute consultation/i,
    );
  });

  // A voluntarily-booked LIA session must NOT lock a non-flagged lead.
  it('non-flagged lead is unaffected by LIA sessions (FREE_15 alone governs)', async () => {
    const { service, findFirst } = makeService({ free15Completed: true, liaVerdict: LegalDecision.REJECTED });
    await expect(callGate(service, { id: 'lead-1b', liaEscalationRequired: false })).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledTimes(1); // LIA verdict never consulted
  });

  // ── Scenario 3 — red-flagged, FREE_15 done, no LIA verdict yet ───────────
  it('scenario 3: red-flagged + FREE_15 done + no LIA verdict → blocked', async () => {
    const { service } = makeService({ free15Completed: true, liaVerdict: null });
    await expect(callGate(service, { id: 'lead-3', liaEscalationRequired: true })).rejects.toThrow(
      /flagged immigration\/legal concern/i,
    );
  });

  // Even a red-flagged lead is blocked first if FREE_15 isn't done (order matters).
  it('red-flagged + no FREE_15 → blocked on the free-consult rule first', async () => {
    const { service } = makeService({ free15Completed: false, liaVerdict: LegalDecision.APPROVED });
    await expect(callGate(service, { id: 'lead-3b', liaEscalationRequired: true })).rejects.toThrow(
      /free 15-minute consultation/i,
    );
  });

  // ── Scenario 4 — red-flagged, unlock + each non-approve lock ─────────────
  it('scenario 4: red-flagged + FREE_15 done + LIA APPROVED → allowed', async () => {
    const { service, findFirst } = makeService({ free15Completed: true, liaVerdict: LegalDecision.APPROVED });
    await expect(callGate(service, { id: 'lead-4', liaEscalationRequired: true })).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledTimes(2); // FREE_15 then LIA verdict
  });

  it('scenario 4: NEEDS_MORE_INFO keeps it locked with its own message', async () => {
    const { service } = makeService({ free15Completed: true, liaVerdict: LegalDecision.NEEDS_MORE_INFO });
    await expect(callGate(service, { id: 'lead-4a', liaEscalationRequired: true })).rejects.toThrow(
      /needs more information/i,
    );
  });

  it('scenario 4: REJECTED keeps it locked (did-not-approve message)', async () => {
    const { service } = makeService({ free15Completed: true, liaVerdict: LegalDecision.REJECTED });
    await expect(callGate(service, { id: 'lead-4b', liaEscalationRequired: true })).rejects.toThrow(
      /did not approve/i,
    );
  });

  it('scenario 4: WITHDRAWN keeps it locked (withdrawn message)', async () => {
    const { service } = makeService({ free15Completed: true, liaVerdict: LegalDecision.WITHDRAWN });
    await expect(callGate(service, { id: 'lead-4c', liaEscalationRequired: true })).rejects.toThrow(
      /withdrawn/i,
    );
  });
});
