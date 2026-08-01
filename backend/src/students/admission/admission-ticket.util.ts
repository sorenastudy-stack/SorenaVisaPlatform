import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';

// PR-ADMISSION-SHARED / PR-INTAKE-1 — shared notifier: append a SYSTEM message to
// the case's persistent ADMISSIONS support-ticket thread (find-or-create), so
// student-facing admission notices land in "Messages & support". Resolves/creates
// the VisaCase (the ticket hangs off it) via Case → AdmissionApplication →
// VisaApplication → VisaCase, mirroring DashboardService.ensureDashboardRows.
//
// Best-effort by contract: returns silently if the case can't be resolved. Callers
// wrap in their own try/catch too — a notification must never fail the action.
export async function notifyAdmissionTicket(
  prisma: PrismaService,
  crypto: CryptoService,
  params: { caseId: string; message: string; authorId: string | null },
): Promise<void> {
  const app = await prisma.admissionApplication.findFirst({ where: { caseId: params.caseId }, select: { id: true } });
  if (!app || !params.authorId) return;

  const kase = await prisma.case.findUnique({
    where: { id: params.caseId },
    select: { lead: { select: { contact: { select: { userId: true } } } } },
  });
  const clientId = kase?.lead?.contact?.userId;
  if (!clientId) return;

  let visaApp = await prisma.visaApplication.findUnique({ where: { applicationId: app.id }, select: { id: true } });
  if (!visaApp) visaApp = await prisma.visaApplication.create({ data: { applicationId: app.id }, select: { id: true } });
  let visaCase = await prisma.visaCase.findUnique({ where: { visaApplicationId: visaApp.id }, select: { id: true } });
  if (!visaCase) visaCase = await prisma.visaCase.create({ data: { visaApplicationId: visaApp.id, clientId, status: 'DRAFT' }, select: { id: true } });

  let ticket = await prisma.visaSupportTicket.findFirst({
    where: { caseId: visaCase.id, department: 'ADMISSIONS', status: { in: ['OPEN', 'IN_PROGRESS'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!ticket) {
    ticket = await prisma.visaSupportTicket.create({
      data: {
        clientId, caseId: visaCase.id, department: 'ADMISSIONS',
        subjectEncrypted: crypto.encrypt('Your programme list') as never,
        status: 'OPEN', priority: 'NORMAL',
      },
      select: { id: true },
    });
  }

  await prisma.visaSupportTicketMessage.create({
    data: {
      ticketId: ticket.id,
      authorId: params.authorId,
      authorRole: 'SYSTEM',
      bodyEncrypted: crypto.encrypt(params.message) as never,
    },
  });
  await prisma.visaSupportTicket.update({ where: { id: ticket.id }, data: { lastStaffMessageAt: new Date(), status: 'OPEN' } });
}
