import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocuSignService } from './docusign.service';
import { CreateContractDto } from './dto/create-contract.dto';

@Injectable()
export class ContractsService {
  constructor(
    private prisma: PrismaService,
    private docuSignService: DocuSignService,
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
    return this.prisma.contract.create({
      data: {
        caseId: dto.caseId,
        docusignEnvelopeId: envelopeId,
        status: 'SENT',
      },
    });
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

    // Update contract
    const updateData: any = { status: statusData.status };

    if (statusData.status === 'completed') {
      updateData.signedAt = new Date(statusData.signedAt);
      updateData.signedFileUrl = statusData.signedFileUrl;
      updateData.auditTrailUrl = statusData.auditTrailUrl;
    } else if (statusData.status === 'declined') {
      updateData.declinedAt = new Date(statusData.declinedAt);
    } else if (statusData.status === 'expired') {
      updateData.expiredAt = new Date(statusData.expiredAt);
    }

    return this.prisma.contract.update({
      where: { id: contract.id },
      data: updateData,
    });
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
