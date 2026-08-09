/* PR-PHASE38 — create (or remove) ONE internal QA account with the engagement
 * fee marked paid, so the payment-gated surfaces (Explore, Recommendations,
 * Documents, Visa application, Apply/Study) can be inspected against REAL
 * production data.
 *
 * WHY A REAL INVOICE ROW EXISTS. There is no `paid` flag on User or Case. The
 * gate reads exactly one thing:
 *
 *     resolveOwnCaseId()      → Case.lead.contact.userId
 *     getEngagementGateState()→ Invoice(invoiceNumber = `ENG-${caseId}`, PAID)
 *
 * So an invoice row is unavoidable. What IS avoidable is pretending it is
 * money: the amount is 0.00, nothing is created in Stripe, no `payments` row is
 * written, and every row carries the [TEST ACCOUNT] marker so it can be
 * filtered out of any report. The one place it surfaces is
 * staff-payments.service.ts confirmedRows(), which lists PAID ENG- invoices —
 * there it appears as a clearly-labelled zero.
 *
 * Run:
 *   npx ts-node --transpile-only scripts/create-internal-test-account.ts --dry-run
 *   npx ts-node --transpile-only scripts/create-internal-test-account.ts --confirm-production
 *   npx ts-node --transpile-only scripts/create-internal-test-account.ts --undo --confirm-production
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

const EMAIL = 'internal-test@sorenavisa.com';
const MARKER = '[TEST ACCOUNT]';
const FULL_NAME = `${MARKER} Internal QA — not a client`;

const dryRun = process.argv.includes('--dry-run');
const undo = process.argv.includes('--undo');
const confirmed = process.argv.includes('--confirm-production');

// ── PRODUCTION GUARD ────────────────────────────────────────────────────────
// Same rail as seed-study-fields.ts and backfill-programme-study-fields.ts.
function guard(): PrismaClient {
  const url = process.env.DATABASE_URL ?? '';
  if (!url) { console.error('REFUSING TO RUN: DATABASE_URL is not set.'); process.exit(1); }
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const host = (() => { try { return new URL(url).hostname; } catch { return '(unparseable host)'; } })();

  if (!isLocal && !confirmed && !dryRun) {
    console.error('REFUSING TO RUN: DATABASE_URL is not local.');
    console.error(`  target host : ${host}`);
    console.error('');
    console.error('This writes users, contacts, leads, cases and invoices.');
    console.error('  ...--dry-run            to preview');
    console.error('  ...--confirm-production to create');
    console.error('  ...--undo --confirm-production to remove');
    process.exit(1);
  }
  if (!isLocal && !dryRun) {
    console.log(`⚠ RUNNING AGAINST A NON-LOCAL DATABASE — host ${host}\n`);
  }
  if (dryRun) console.log(`DRY RUN — no writes. Target host: ${host}\n`);
  return new PrismaClient();
}

const prisma = guard();

/** Everything this script owns, found by its markers rather than by stored ids. */
async function existing() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  const contact = user
    ? await prisma.contact.findFirst({ where: { userId: user.id }, select: { id: true } })
    : null;
  const lead = contact
    ? await prisma.lead.findFirst({ where: { contactId: contact.id }, select: { id: true } })
    : null;
  const kase = lead
    ? await prisma.case.findFirst({ where: { leadId: lead.id }, select: { id: true } })
    : null;
  const invoice = kase
    ? await prisma.invoice.findFirst({ where: { invoiceNumber: `ENG-${kase.id}` }, select: { id: true, status: true } })
    : null;
  return { user, contact, lead, kase, invoice };
}

async function report(): Promise<void> {
  const e = await existing();
  console.log('CURRENT STATE');
  console.log(`  users     ${e.user ? 'EXISTS ' + e.user.id : '— none'}`);
  console.log(`  contacts  ${e.contact ? 'EXISTS ' + e.contact.id : '— none'}`);
  console.log(`  leads     ${e.lead ? 'EXISTS ' + e.lead.id : '— none'}`);
  console.log(`  cases     ${e.kase ? 'EXISTS ' + e.kase.id : '— none'}`);
  console.log(`  invoices  ${e.invoice ? `EXISTS ${e.invoice.id} (${e.invoice.status})` : '— none'}`);

  if (undo) {
    console.log('\nWOULD DELETE, in FK-safe order:');
    for (const [t, v] of [['invoices', e.invoice], ['cases', e.kase], ['leads', e.lead], ['contacts', e.contact], ['users', e.user]] as const) {
      console.log(`  ${v ? 'DELETE' : 'skip  '}  ${t}`);
    }
    console.log('\nNothing exists in Stripe to remove — none was ever created.');
    return;
  }

  console.log('\nWOULD CREATE');
  console.log(`  users     email=${EMAIL}  role=STUDENT  isActive=true`);
  console.log(`            passwordHash=<bcrypt of a freshly generated random password>`);
  console.log(`  contacts  fullName="${FULL_NAME}"  email=${EMAIL}  userId→user`);
  console.log(`  leads     contactId→contact  leadStatus=<schema default>`);
  console.log(`  cases     leadId→lead  stage=<schema default>`);
  console.log(`  invoices  invoiceNumber="ENG-{caseId}"`);
  console.log(`            amount=0.00  currency=USD  status=PAID  paidAt=now`);
  console.log(`            stripeInvoiceId=null   ← nothing in Stripe`);
  console.log(`            description="${MARKER} Internal QA access — not a real payment"`);

  console.log('\nWOULD NOT TOUCH');
  console.log('  Stripe (no Customer, Charge, PaymentIntent or Price)');
  console.log('  payments, commissions, applications, any other table');
  console.log('  any existing row — every write is an insert of a new row');

  console.log('\nFINANCIAL VISIBILITY');
  console.log('  dashboard revenue reads `commissions`, not `invoices` — unaffected.');
  console.log('  staff-payments confirmedRows() lists PAID ENG- invoices — this one');
  console.log('  appears there, labelled, at 0.00.');
}

async function create(): Promise<void> {
  const e = await existing();
  if (e.user) {
    console.error(`REFUSING: ${EMAIL} already exists (user ${e.user.id}). Run --undo first.`);
    process.exit(1);
  }

  // Shown ONCE, never stored. 24 random bytes → 32 url-safe chars.
  const password = randomBytes(24).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 10);

  const out = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: EMAIL, name: FULL_NAME, role: 'STUDENT', passwordHash, isActive: true },
      select: { id: true },
    });
    const contact = await tx.contact.create({
      data: { fullName: FULL_NAME, email: EMAIL, userId: user.id },
      select: { id: true },
    });
    const lead = await tx.lead.create({ data: { contactId: contact.id }, select: { id: true } });
    const kase = await tx.case.create({ data: { leadId: lead.id }, select: { id: true } });
    const invoice = await tx.invoice.create({
      data: {
        caseId: kase.id,
        contactId: contact.id,
        invoiceNumber: `ENG-${kase.id}`,
        description: `${MARKER} Internal QA access — not a real payment`,
        amount: 0,
        currency: 'USD',
        status: 'PAID',
        paidAt: new Date(),
        notes: `${MARKER} Created by scripts/create-internal-test-account.ts to unlock the payment-gated surfaces for manual QA. Zero amount, no Stripe object. Remove with --undo.`,
      },
      select: { id: true },
    });
    return { user, contact, lead, kase, invoice };
  });

  console.log('CREATED');
  console.log(`  user     ${out.user.id}`);
  console.log(`  contact  ${out.contact.id}`);
  console.log(`  lead     ${out.lead.id}`);
  console.log(`  case     ${out.kase.id}`);
  console.log(`  invoice  ${out.invoice.id}  (ENG-${out.kase.id}, 0.00 USD, PAID)`);
  console.log('\n──────────────────────────────────────────────────────────');
  console.log(`  ${EMAIL}`);
  console.log(`  ${password}`);
  console.log('  Shown once. Not stored anywhere. Save it now.');
  console.log('──────────────────────────────────────────────────────────');
}

async function remove(): Promise<void> {
  const e = await existing();
  if (!e.user) { console.log('Nothing to remove.'); return; }

  // Delete in FK-safe order. If the account has accumulated side records
  // (messages, bookings, uploads) a delete will fail on its foreign key — that
  // is reported rather than force-cascaded, because cascading through a case is
  // exactly how a script like this destroys more than it made.
  try {
    await prisma.$transaction(async (tx) => {
      if (e.invoice) await tx.invoice.delete({ where: { id: e.invoice.id } });
      if (e.kase) await tx.case.delete({ where: { id: e.kase.id } });
      if (e.lead) await tx.lead.delete({ where: { id: e.lead.id } });
      if (e.contact) await tx.contact.delete({ where: { id: e.contact.id } });
      await tx.user.delete({ where: { id: e.user!.id } });
    });
    console.log('Removed: invoice, case, lead, contact, user.');
  } catch (err: any) {
    console.error('REMOVAL STOPPED — nothing was deleted (the transaction rolled back).');
    console.error(`  ${err.message.split('\n')[0]}`);
    console.error('');
    console.error('This usually means the test account accumulated related records');
    console.error('(a message, booking, upload…). Clear those first, deliberately.');
    process.exit(1);
  }
}

(async () => {
  if (dryRun) return report();
  if (undo) return remove();
  return create();
})()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
