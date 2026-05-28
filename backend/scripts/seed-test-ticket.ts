/* eslint-disable no-console */
/**
 * One-off seed — create a single VisaSupportTicket (with an opening
 * client message) so the staff ticket UI can be verified end-to-end.
 *
 * What this writes:
 *   - Up to 1 VisaCase row (only if NONE exists yet — find-first, then
 *     create from the most recent VisaApplication's chain). Idempotent.
 *   - 1 VisaSupportTicket row (department=DOCUMENTS, status=OPEN,
 *     priority=NORMAL, assignedStaffId=null).
 *   - 1 VisaSupportTicketMessage row (authorRole=CLIENT,
 *     isInternalNote=false).
 *   - Sets the ticket's lastClientMessageAt to "now".
 *
 * Safe to run multiple times — re-running creates a NEW ticket on
 * the same case each time (which is what the seed is for: spam-free
 * test data). The VisaCase creation step is gated, so the unique
 * constraint on visaApplicationId never trips.
 *
 * No audit row is written: this is test data, not a real user action.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CryptoService } from '../src/common/crypto/crypto.service';

const TICKET_SUBJECT = 'Test - question about my visa documents';
const TICKET_BODY    = "Hi, I'm not sure which documents I still need to upload. Can you help?";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const crypto = app.get(CryptoService);

  // Step 1 — find or bootstrap a VisaCase.
  let visaCase = await prisma.visaCase.findFirst({
    select: { id: true, clientId: true },
  });

  if (!visaCase) {
    console.log('[seed] no VisaCase exists — bootstrapping one from the most recent VisaApplication');

    const visaApp = await prisma.visaApplication.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { id: true, applicationId: true },
    });
    if (!visaApp) {
      throw new Error('Cannot seed a ticket: no VisaApplication row exists in the DB.');
    }

    // Walk the chain to find the owning User (the VisaCase.clientId).
    const adm = await prisma.admissionApplication.findUnique({
      where: { id: visaApp.applicationId },
      select: { caseId: true },
    });
    if (!adm) throw new Error('AdmissionApplication missing for this VisaApplication.');

    const crmCase = await prisma.case.findUnique({
      where: { id: adm.caseId },
      select: { leadId: true },
    });
    if (!crmCase) throw new Error('Case missing for this AdmissionApplication.');

    const lead = await prisma.lead.findUnique({
      where: { id: crmCase.leadId },
      select: { contactId: true },
    });
    if (!lead) throw new Error('Lead missing for this Case.');

    const contact = await prisma.contact.findUnique({
      where: { id: lead.contactId },
      select: { userId: true, fullName: true },
    });
    if (!contact?.userId) {
      throw new Error('Contact has no linked User — cannot determine VisaCase.clientId.');
    }

    visaCase = await prisma.visaCase.create({
      data: {
        visaApplicationId: visaApp.id,
        clientId:          contact.userId,
        status:            'DRAFT',
        // statusChangedBy left null (system-set on creation).
      },
      select: { id: true, clientId: true },
    });
    console.log(`[seed] created VisaCase ${visaCase.id} for client ${contact.fullName} (${contact.userId})`);
  } else {
    console.log(`[seed] reusing existing VisaCase ${visaCase.id} (client ${visaCase.clientId})`);
  }

  // Step 2 — create the ticket + opening message in one transaction.
  const subjectEncrypted = crypto.encrypt(TICKET_SUBJECT);
  const bodyEncrypted    = crypto.encrypt(TICKET_BODY);
  const now = new Date();

  const ticket = await prisma.$transaction(async (tx) => {
    const t = await tx.visaSupportTicket.create({
      data: {
        clientId:            visaCase!.clientId,
        caseId:              visaCase!.id,
        department:          'DOCUMENTS',
        subjectEncrypted:    subjectEncrypted as never,
        status:              'OPEN',
        priority:            'NORMAL',
        assignedStaffId:     null,
        lastClientMessageAt: now,
      },
      select: { id: true, createdAt: true },
    });

    await tx.visaSupportTicketMessage.create({
      data: {
        ticketId:       t.id,
        authorId:       visaCase!.clientId,
        authorRole:     'CLIENT',
        bodyEncrypted:  bodyEncrypted as never,
        isInternalNote: false,
      },
    });

    return t;
  });

  console.log('');
  console.log('─────────────────────────────────────────────');
  console.log('Seeded ticket:');
  console.log(`  ticket id   : ${ticket.id}`);
  console.log(`  case id     : ${visaCase.id}`);
  console.log(`  client id   : ${visaCase.clientId}`);
  console.log(`  department  : DOCUMENTS`);
  console.log(`  status      : OPEN`);
  console.log(`  priority    : NORMAL`);
  console.log(`  subject     : "${TICKET_SUBJECT}"`);
  console.log(`  body length : ${TICKET_BODY.length} chars (encrypted on row)`);
  console.log(`  detail URL  : /staff/tickets/${ticket.id}`);
  console.log('─────────────────────────────────────────────');
  console.log('');

  await app.close();
}

main().catch((err) => {
  console.error('[seed] fatal:', err);
  process.exit(1);
});
