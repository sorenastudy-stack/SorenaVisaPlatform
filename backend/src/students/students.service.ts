import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService) {}

  private async getContactByUserId(userId: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { userId },
    });
    if (!contact) {
      throw new NotFoundException('Student profile not found');
    }
    return contact;
  }

  async getProfile(userId: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        nationality: true,
        countryOfResidence: true,
        preferredLanguage: true,
        lifecycleStage: true,
        photoUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!contact) {
      throw new NotFoundException('Student profile not found');
    }
    return contact;
  }

  async getCase(userId: string) {
    const contact = await this.getContactByUserId(userId);

    // Find the most recent lead for this contact
    const lead = await this.prisma.lead.findFirst({
      where: { contactId: contact.id },
      orderBy: { createdAt: 'desc' },
    });

    if (!lead) {
      return null;
    }

    const caseRecord = await this.prisma.case.findFirst({
      where: { leadId: lead.id },
      include: {
        applications: {
          include: {
            provider: {
              select: { id: true, name: true, providerType: true },
            },
            programme: {
              select: { id: true, name: true, level: true, durationMonths: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return caseRecord;
  }

  async getDocuments(userId: string) {
    const contact = await this.getContactByUserId(userId);

    // Find lead -> case -> applications -> documents
    const lead = await this.prisma.lead.findFirst({
      where: { contactId: contact.id },
      orderBy: { createdAt: 'desc' },
    });

    if (!lead) {
      return [];
    }

    const caseRecord = await this.prisma.case.findFirst({
      where: { leadId: lead.id },
      orderBy: { createdAt: 'desc' },
    });

    if (!caseRecord) {
      return [];
    }

    const applications = await this.prisma.application.findMany({
      where: { caseId: caseRecord.id },
      include: {
        documents: true,
      },
    });

    return applications.flatMap((app) => app.documents);
  }

  // PR-TICKET-CONSOLIDATION — getTickets / getTicket / createTicket /
  // replyToTicket lived here and read prisma.ticket (the legacy model). Their
  // controller routes shadowed TicketsController, which serves the same paths
  // from VisaSupportTicket. Removed with the routes; the canonical
  // implementation is students/tickets/tickets.service.ts.
  //
  // The `tickets` table is intentionally left in the database, unreferenced.


  async getInvoices(userId: string) {
    const contact = await this.getContactByUserId(userId);

    // PR-LIA-AUTO-ASSIGN Phase 6 (Option A): the per-invoice payment
    // line-items include block was removed when the invoice-line Payment
    // model was replaced by the Stripe-webhook-event Payment model.
    // When the student-facing invoice receipts page ships (today it's
    // not available yet), the AR domain is redesigned and this endpoint
    // gets its payment breakdown back — either by adding `invoiceId`
    // to the new Payment model, or by introducing a fresh
    // `InvoicePayment` join table.
    return this.prisma.invoice.findMany({
      where: { contactId: contact.id },
      orderBy: { createdAt: 'desc' },
    });
  }
}
