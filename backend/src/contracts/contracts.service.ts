import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ContractStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DocuSignService } from './docusign.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { LiaAssignmentService } from '../cases/lia-assignment.service';
import { docusignToContractStatus } from './contract-status';

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    private prisma: PrismaService,
    private docuSignService: DocuSignService,
    private notificationsService: NotificationsService,
    // PR-LIA-2 — auto-assign an LIA the moment the client signs.
    // The injection is one-directional (Contracts -> Cases-side
    // LiaAssignmentService); no circular import risk.
    private liaAssignments: LiaAssignmentService,
  ) {}

  async createContract(dto: CreateContractDto) {
    // Validate case exists and doesn't already have contract
    const caseRecord = await this.prisma.case.findUnique({
      where: { id: dto.caseId },
      include: { contract: true, lead: { include: { contact: true } } },
    });

    if (!caseRecord) {
      throw new NotFoundException('Case not found');
    }

    if (caseRecord.contract) {
      throw new NotFoundException('Contract already exists for this case');
    }

    // Create DocuSign envelope
    const envelopeId = await this.docuSignService.createEnvelope(
      dto.caseId,
      caseRecord.lead.contact.email,
      caseRecord.lead.contact.fullName,
    );

    // Create contract record
    const contract = await this.prisma.contract.create({
      data: {
        caseId: dto.caseId,
        docusignEnvelopeId: envelopeId,
        status: 'SENT',
      },
    });

    // Get signing URL
    const signingUrl = await this.docuSignService.getSigningUrl(
      envelopeId,
      caseRecord.lead.contact.email,
      caseRecord.lead.contact.fullName,
      `${process.env.FRONTEND_URL || 'http://localhost:3000'}/contract-signed`,
    );

    // Send contract ready email
    await this.notificationsService.sendContractReady(
      caseRecord.lead.contact.email,
      caseRecord.lead.contact.fullName,
      signingUrl,
    );

    return contract;
  }

  async getContract(caseId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { caseId },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    return contract;
  }

  async handleWebhook(envelopeId: string) {
    // Find contract by envelope ID
    const contract = await this.prisma.contract.findFirst({
      where: { docusignEnvelopeId: envelopeId },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found for envelope');
    }

    // Sync status from DocuSign
    const statusData = await this.docuSignService.syncStatus(envelopeId);

    // PR-LIA-AUTO-ASSIGN, Phase 5 — map the raw DocuSign envelope status
    // ("completed", "declined", ...) to the ContractStatus enum
    // (SIGNED, DECLINED, ...). Unknown DocuSign statuses are skipped
    // with a warning rather than written as raw text (the previous
    // behaviour produced rows whose status didn't match any enum value).
    const mappedStatus = docusignToContractStatus(statusData.status);
    if (!mappedStatus) {
      this.logger.warn(
        `handleWebhook: unknown DocuSign status "${statusData.status}" for envelope ${envelopeId} — skipping status update`,
      );
      return contract;
    }

    // Update contract
    const updateData: any = { status: mappedStatus };

    if (mappedStatus === ContractStatus.SIGNED) {
      updateData.signedAt = new Date(statusData.signedAt);
      updateData.signedFileUrl = statusData.signedFileUrl;
      updateData.auditTrailUrl = statusData.auditTrailUrl;
    } else if (mappedStatus === ContractStatus.DECLINED) {
      updateData.declinedAt = new Date(statusData.declinedAt);
    } else if (mappedStatus === ContractStatus.EXPIRED) {
      updateData.expiredAt = new Date(statusData.expiredAt);
    }

    const updated = await this.prisma.contract.update({
      where: { id: contract.id },
      data: updateData,
    });

    // PR-LIA-2 — fire LIA auto-assignment on successful sign. The
    // contract update has already committed; this is a follow-up
    // side effect that must never block the webhook response.
    // Failures (no active LIAs, transient DB error) are logged and
    // an audit row is written by the service. Idempotent: if the
    // case already has an LIA, the service is a no-op.
    if (mappedStatus === ContractStatus.SIGNED) {
      try {
        const result = await this.liaAssignments.assignLiaToCase(contract.caseId);
        if (result.status === 'assigned') {
          this.logger.log(
            `LIA ${result.liaName} (${result.liaId}) auto-assigned to case ${contract.caseId} on contract sign`,
          );
        } else if (result.status === 'no_candidates') {
          this.logger.warn(
            `Contract for case ${contract.caseId} signed but no active LIAs available — case left unassigned`,
          );
        }
      } catch (err: any) {
        this.logger.error(
          `LIA auto-assignment failed for case ${contract.caseId}: ${err?.message ?? err}`,
        );
      }
    }

    return updated;
  }

  async getSigningUrl(caseId: string, returnUrl: string) {
    const contract = await this.getContract(caseId);

    if (!contract.docusignEnvelopeId) {
      throw new NotFoundException('Envelope ID not found');
    }

    const caseRecord = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { lead: { include: { contact: true } } },
    });

    if (!caseRecord) {
      throw new NotFoundException('Case not found');
    }

    return this.docuSignService.getSigningUrl(
      contract.docusignEnvelopeId,
      caseRecord.lead.contact.email,
      caseRecord.lead.contact.fullName,
      returnUrl,
    );
  }
}
