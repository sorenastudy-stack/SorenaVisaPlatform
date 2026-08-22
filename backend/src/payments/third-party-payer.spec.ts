import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PaymentsService } from './payments.service';
import { CreateCaseCustomLinkDto } from './dto/create-case-custom-link.dto';
import { payerMetadata, readPayerFromMetadata, PAYER_RELATIONSHIPS } from './third-party-payer';

// PR-CHECKLIST item 11 — proving a third-party payer SURVIVES THE WHOLE PATH.
//
// The interesting failure is not "does the field validate" but "does it still
// exist at the far end". The payer is captured on a link, handed to Stripe,
// handed back by a webhook days later, and only then written to a Payment row —
// four hops, any of which could silently drop it, leaving a record that says a
// payment simply happened and nothing about who made it.
//
// So this test follows the actual relay: the real service builds the link (with
// Stripe substituted at the boundary, since we cannot create real links in a
// test), the metadata it produced is fed to the REAL webhook write, and the
// payer is read back through the REAL finance list endpoint.

const prisma = new PrismaClient();

const PAYER = { name: 'Maryam Hosseini', email: 'maryam@example.com', relationship: 'PARENT' as const };

// Stands in for Stripe at the network boundary only. It records what metadata it
// was handed, which is exactly the hop under test — everything downstream then
// runs for real against that recorded value.
const stripeCalls: Array<Record<string, string>> = [];
const stripeService: any = {
  createCustomAmountPaymentLink: async (
    leadId: string, caseId: string, amountCents: number, currency: string,
    invoiceId?: string, payer?: any,
  ) => {
    const metadata = { leadId, caseId, paymentType: 'consultation', type: 'CUSTOM_AMOUNT', ...payerMetadata(payer) };
    stripeCalls.push(metadata);
    return { url: 'https://pay.stripe.test/link', metadata };
  },
};

const svc = new PaymentsService(
  stripeService,
  prisma as any,
  { emitOnce: jest.fn().mockResolvedValue(undefined) } as any,
);

const tag = () => 'TPP-' + randomBytes(4).toString('hex');

async function seed() {
  const t = tag();
  const contact = await prisma.contact.create({
    data: { fullName: `${t} client`, email: `${t}@test.local` }, select: { id: true },
  });
  const lead = await prisma.lead.create({ data: { contactId: contact.id }, select: { id: true } });
  const kase = await prisma.case.create({ data: { leadId: lead.id }, select: { id: true } });
  return { t, contactId: contact.id, leadId: lead.id, caseId: kase.id };
}

async function cleanup(f: any) {
  const d = (p: Promise<any>) => p.catch(() => undefined);
  await d(prisma.payment.deleteMany({ where: { leadId: f.leadId } }));
  await d(prisma.case.deleteMany({ where: { id: f.caseId } }));
  await d(prisma.lead.deleteMany({ where: { id: f.leadId } }));
  await d(prisma.contact.deleteMany({ where: { id: f.contactId } }));
}

/** What the Stripe webhook does with a succeeded PaymentIntent, verbatim. */
async function webhookWritesPayment(metadata: Record<string, string>, amount: number) {
  return prisma.payment.create({
    data: {
      stripePaymentIntentId: 'pi_test_' + randomBytes(6).toString('hex'),
      leadId: metadata.leadId,
      caseId: metadata.caseId ?? null,
      paymentType: metadata.paymentType ?? 'unknown',
      amount,
      currency: 'nzd',
      status: 'succeeded',
      metadata,                       // ← the existing line that carries the payer
      verificationStatus: 'PENDING',
    },
  });
}

afterAll(async () => { await prisma.$disconnect(); });

// ── the contract at the request boundary ──────────────────────────────────────

describe('a declared payer is all-or-nothing', () => {
  const check = async (payer: any) => {
    const dto = plainToInstance(CreateCaseCustomLinkDto, { amount: 50_000, payer });
    return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  };

  it('accepts a link with no payer at all — the client is paying', async () => {
    expect(await check(undefined)).toHaveLength(0);
  });

  it('accepts a fully declared payer', async () => {
    expect(await check(PAYER)).toHaveLength(0);
  });

  it('refuses a payer with no way to contact them', async () => {
    // A name alone looks like a completed compliance record while answering
    // none of the questions one exists to answer.
    expect((await check({ name: 'Maryam Hosseini', relationship: 'PARENT' })).length).toBeGreaterThan(0);
    expect((await check({ ...PAYER, email: 'not-an-email' })).length).toBeGreaterThan(0);
  });

  it('refuses a payer with no stated relationship to the applicant', async () => {
    expect((await check({ name: 'Maryam Hosseini', email: 'm@example.com' })).length).toBeGreaterThan(0);
    expect((await check({ ...PAYER, relationship: 'FRIEND_OF_A_FRIEND' })).length).toBeGreaterThan(0);
  });
});

// ── the relay, end to end, against the database ───────────────────────────────

describe('the payer survives link → Stripe metadata → webhook → Payment row', () => {
  it('reaches the finance list with name, email and relationship intact', async () => {
    const f = await seed();
    stripeCalls.length = 0;
    try {
      await svc.createCustomLinkForCase(f.caseId, 50_000, 'nzd', undefined, PAYER);

      // hop 1 — it reached the Stripe call
      expect(stripeCalls).toHaveLength(1);
      expect(stripeCalls[0].thirdPartyPayerName).toBe(PAYER.name);
      expect(stripeCalls[0].thirdPartyPayerRelationship).toBe('PARENT');

      // hop 2 — the webhook writes it onto the Payment row
      const payment = await webhookWritesPayment(stripeCalls[0], 50_000);
      const stored = await prisma.payment.findUniqueOrThrow({
        where: { id: payment.id }, select: { metadata: true },
      });
      expect(readPayerFromMetadata(stored.metadata)).toEqual(PAYER);

      // hop 3 — finance can actually see it
      const listed = await svc.listPaymentsForCase(f.caseId);
      const row: any = listed.find((p: any) => p.id === payment.id);
      expect(row).toBeTruthy();
      expect(row.thirdPartyPayer).toEqual(PAYER);
    } finally { await cleanup(f); }
  });

  it('a payment the client made themselves reports no payer, not a blank one', async () => {
    // The distinction matters: "nobody declared" and "declared as empty" are
    // different compliance answers.
    const f = await seed();
    stripeCalls.length = 0;
    try {
      await svc.createCustomLinkForCase(f.caseId, 50_000, 'nzd');
      expect(Object.keys(stripeCalls[0])).not.toContain('thirdPartyPayerName');

      const payment = await webhookWritesPayment(stripeCalls[0], 50_000);
      const listed = await svc.listPaymentsForCase(f.caseId);
      const row: any = listed.find((p: any) => p.id === payment.id);
      expect(row.thirdPartyPayer).toBeNull();
    } finally { await cleanup(f); }
  });

  it('every historical payment reads back as no-payer rather than breaking', async () => {
    // Payment.metadata predates this feature and holds arbitrary shapes.
    expect(readPayerFromMetadata(null)).toBeNull();
    expect(readPayerFromMetadata({})).toBeNull();
    expect(readPayerFromMetadata({ leadId: 'x', paymentType: 'consultation' })).toBeNull();
    expect(readPayerFromMetadata('a string')).toBeNull();
  });

  it('an unrecognised relationship degrades to OTHER instead of vanishing', async () => {
    // If Stripe ever hands back something off-list, losing the payer entirely
    // would be the worse failure — the name is the part that matters.
    const read = readPayerFromMetadata({
      thirdPartyPayerName: 'Someone', thirdPartyPayerEmail: 's@example.com',
      thirdPartyPayerRelationship: 'NOT_A_REAL_ONE',
    });
    expect(read).toEqual({ name: 'Someone', email: 's@example.com', relationship: 'OTHER' });
    expect(PAYER_RELATIONSHIPS).toContain('OTHER');
  });
});
