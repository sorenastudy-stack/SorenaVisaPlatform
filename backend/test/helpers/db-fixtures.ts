/**
 * PR-LIA-AUTO-ASSIGN Phase 7 (Option A) — DB seed/cleanup helpers for
 * the payments-webhook test suite.
 *
 * Seeds the minimum row set `handlePaymentSucceeded` needs to do real
 * work end-to-end:
 *
 *   User    (role=LIA, isActive=true) → so the load-balanced auto-pick
 *                                       inside assignLiaToCase has a
 *                                       candidate. Created fresh per
 *                                       test rather than reusing prod
 *                                       data so the open-cases counter
 *                                       starts at zero.
 *   Contact (email-unique)
 *   Lead    (executionAllowed=true, hardStopFlag=false, contactId=...)
 *   Case    (leadId=..., stage=ADMISSION, liaId=null)
 *   Contract (caseId=..., signedAt optionally set)
 *
 * cleanupFixture deletes in reverse FK order. It also sweeps any rows
 * the system-under-test wrote — Payment (keyed by leadId) and AuditLog
 * (keyed by entityId=caseId) — so a fresh seed in the next test starts
 * from a clean slate.
 *
 * Why not wrap each test in $transaction(... { throw }) for rollback?
 *
 *   The handler under test calls assignLiaToCase which opens its OWN
 *   prisma.$transaction internally. Nested transactions in Prisma don't
 *   compose with an outer transaction the way one might hope — the
 *   inner tx commits/rolls back independently of the outer, so a
 *   "wrap-in-tx-then-throw" pattern leaves the case.liaId update
 *   committed even after the outer rollback. Per-test seed + per-test
 *   delete is the honest pattern for this kind of integration test.
 *
 * Why not mock Prisma entirely?
 *
 *   Option A's value is exercising the real prisma calls so we catch
 *   P2002 (unique-constraint) behaviour, the relation includes on
 *   case lookup, and the actual transaction shape that
 *   assignLiaToCase uses. A pure mock would skip all three. Trade-off:
 *   the helper requires a running Postgres and a live DATABASE_URL.
 */

import { PrismaClient } from '@prisma/client';

/**
 * Caller is responsible for the PrismaClient lifecycle (one instance
 * per spec file, $connect in beforeAll, $disconnect in afterAll).
 */
export interface SeededFixture {
  liaUserId:   string;
  contactId:   string;
  leadId:      string;
  caseId:      string;
  contractId:  string;
  /**
   * Pre-built unique paymentIntent ids the spec can use as Stripe
   * idempotency keys. All three are different so a single test run
   * can exercise the three branches (consultation/ACCOUNT_OPENING/
   * subscription) without collision; the retry test reuses one of
   * them to simulate Stripe re-delivering the same event.
   */
  paymentIntentId: {
    accountOpening: string;
    consultation:   string;
    subscription:   string;
  };
}

interface SeedOptions {
  /**
   * Controls whether the seeded Contract carries a non-null `signedAt`.
   * true  → Contract.status = 'SIGNED', signedAt = now
   * false → Contract.status = 'SENT',   signedAt = null
   *
   * The Phase-4 auto-assign trigger is gated on `signedAt IS NOT NULL`,
   * so this is the lever the spec uses to test the "contract unsigned →
   * trigger suppressed" branch.
   */
  contractSigned: boolean;
}

export async function seedFixture(
  prisma: PrismaClient,
  opts: SeedOptions = { contractSigned: true },
): Promise<SeededFixture> {
  // Stamp every test row with a per-run unique suffix so parallel
  // jest workers don't collide on the email-unique constraints.
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tag = '__pr_lia_auto_assign_phase7__';

  // 1. LIA user — created fresh per test so its open-case counter
  //    starts at zero (ensures the load-balanced auto-pick lands on
  //    this user, not on whatever real LIA happens to be in the DB).
  const liaUser = await prisma.user.create({
    data: {
      name:         `Test LIA ${stamp}`,
      email:        `lia.${stamp}@${tag}.test`,
      passwordHash: 'no-login',   // any non-empty string; never verified
      role:         'LIA',
      isActive:     true,
    },
  });

  // 2. Contact
  const contact = await prisma.contact.create({
    data: {
      fullName: `Test Applicant ${stamp}`,
      email:    `applicant.${stamp}@${tag}.test`,
    },
  });

  // 3. Lead — executionAllowed=true so the Case-creation gate would
  //    pass (not strictly needed here since we create the Case
  //    directly, but kept for shape-correctness if the test ever
  //    drives CaseService.createCase).
  const lead = await prisma.lead.create({
    data: {
      contactId:        contact.id,
      executionAllowed: true,
      hardStopFlag:     false,
      leadStatus:       'NEW',
    },
  });

  // 4. Case — stage=ADMISSION, no liaId yet (the Phase-4 trigger is
  //    what should populate it).
  const caseRow = await prisma.case.create({
    data: {
      leadId:    lead.id,
      stage:     'ADMISSION',
      status:    'active',
      riskLevel: 'LOW',
    },
  });

  // 5. Contract — caseId is @unique on the Contract table, so one
  //    contract per case. signedAt presence is the Phase-4 trigger
  //    gate (verified by Contract.findFirst({ where: { caseId,
  //    signedAt: { not: null } } })).
  const contract = await prisma.contract.create({
    data: {
      caseId:             caseRow.id,
      status:             opts.contractSigned ? 'SIGNED' : 'SENT',
      signedAt:           opts.contractSigned ? new Date() : null,
      docusignEnvelopeId: `test-envelope-${stamp}`,
    },
  });

  return {
    liaUserId:  liaUser.id,
    contactId:  contact.id,
    leadId:     lead.id,
    caseId:     caseRow.id,
    contractId: contract.id,
    paymentIntentId: {
      accountOpening: `pi_test_ao_${stamp}`,
      consultation:   `pi_test_consult_${stamp}`,
      subscription:   `pi_test_sub_${stamp}`,
    },
  };
}

/**
 * Tear down everything seedFixture created PLUS any rows the system-
 * under-test wrote against those ids (Payment by leadId, AuditLog by
 * entityId=caseId). Deletes in reverse FK order so referential
 * constraints don't block.
 *
 * Safe to call even if some rows are already gone (uses deleteMany +
 * delete with try/catch on each leaf step so cleanup tolerates a
 * partial-seed failure).
 */
export async function cleanupFixture(
  prisma: PrismaClient,
  ids: SeededFixture,
): Promise<void> {
  // SUT-written rows first
  await prisma.payment.deleteMany({ where: { leadId: ids.leadId } });
  await prisma.auditLog.deleteMany({ where: { entityId: ids.caseId } });

  // Seed rows in reverse FK order
  await safeDelete(() => prisma.contract.delete({ where: { id: ids.contractId } }));
  await safeDelete(() => prisma.case.delete({ where: { id: ids.caseId } }));
  await safeDelete(() => prisma.lead.delete({ where: { id: ids.leadId } }));
  await safeDelete(() => prisma.contact.delete({ where: { id: ids.contactId } }));
  await safeDelete(() => prisma.user.delete({ where: { id: ids.liaUserId } }));
}

async function safeDelete(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    // P2025 = "Record to delete does not exist" — already gone, no-op.
    if ((err as { code?: string })?.code !== 'P2025') {
      throw err;
    }
  }
}
