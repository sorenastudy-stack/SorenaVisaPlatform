import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateVisitorDto } from './dto/create-visitor.dto';
import { CreateEventDto } from './dto/create-event.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { CreateHandoffDto } from './dto/create-handoff.dto';
import { sanitizeString, normalizePhone } from '../common/utils/sanitize.util';
import { LeadStatus, ConsentType, HandoffStatus } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';

@Injectable()
export class AcquisitionService {
  private readonly logger = new Logger(AcquisitionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async createVisitor(dto: CreateVisitorDto, ipAddress: string) {
    const data = {
      ipAddress,
      userAgent: dto.userAgent ? dto.userAgent.substring(0, 500) : undefined,
      country: dto.country || 'NZ',
      referrer: dto.referrer ? sanitizeString(dto.referrer).substring(0, 500) : undefined,
      utmSource: dto.utmSource ? sanitizeString(dto.utmSource) : undefined,
      utmMedium: dto.utmMedium ? sanitizeString(dto.utmMedium) : undefined,
      utmCampaign: dto.utmCampaign ? sanitizeString(dto.utmCampaign) : undefined,
    };

    const fingerprint = dto.fingerprint ? sanitizeString(dto.fingerprint) : null;

    if (fingerprint) {
      return this.prisma.visitor.upsert({
        where: { fingerprint },
        update: { ipAddress, updatedAt: new Date() },
        create: { ...data, fingerprint },
        select: { id: true, createdAt: true },
      });
    }

    return this.prisma.visitor.create({
      data,
      select: { id: true, createdAt: true },
    });
  }

  async createEvent(dto: CreateEventDto, ipAddress: string) {
    return this.prisma.acquisitionEvent.create({
      data: {
        visitorId: dto.visitorId || null,
        eventType: sanitizeString(dto.eventType),
        eventData: dto.eventData || null,
        page: dto.page ? sanitizeString(dto.page) : null,
        ipAddress,
      },
      select: { id: true, createdAt: true },
    });
  }

  async createLead(dto: CreateLeadDto, ipAddress: string, userAgent: string) {
    // Honeypot: silently discard bot submissions
    if (dto.website && dto.website.trim() !== '') {
      this.logger.warn(`Bot detected from IP: ${ipAddress}`);
      return {
        id: 'pending',
        status: 'PENDING',
        emailVerificationRequired: false,
        message: 'Thank you! We will be in touch soon.',
      };
    }

    // Require at least one contact method
    if (!dto.email && !dto.phone && !dto.whatsapp) {
      throw new BadRequestException(
        'Please provide at least one contact method: email, phone, or WhatsApp.',
      );
    }

    const normalizedEmail = dto.email?.toLowerCase().trim() || null;
    const normalizedPhone = dto.phone ? normalizePhone(dto.phone) : null;

    // Duplicate detection: same contact in last 24h
    if (normalizedEmail || normalizedPhone) {
      const orConditions: any[] = [];
      if (normalizedEmail) orConditions.push({ email: normalizedEmail });
      if (normalizedPhone) orConditions.push({ phone: normalizedPhone });

      const existing = await this.prisma.leadCapture.findFirst({
        where: {
          OR: orConditions,
          status: { not: LeadStatus.DISQUALIFIED },
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        select: { id: true, status: true },
      });

      if (existing) {
        // Return success-like response to avoid leaking whether contact exists
        return {
          id: existing.id,
          status: existing.status,
          emailVerificationRequired: !!normalizedEmail,
          message: normalizedEmail
            ? 'Please check your email to verify your details.'
            : 'Thank you! We will be in touch soon.',
        };
      }
    }

    const hasEmail = !!normalizedEmail;
    const initialStatus = hasEmail ? LeadStatus.UNVERIFIED : LeadStatus.VERIFIED;

    let plainToken: string | null = null;

    const lead = await this.prisma.$transaction(async (tx) => {
      const newLead = await tx.leadCapture.create({
        data: {
          visitorId: dto.visitorId || null,
          fullName: sanitizeString(dto.fullName.trim()),
          email: normalizedEmail,
          phone: normalizedPhone,
          whatsapp: dto.whatsapp ? normalizePhone(dto.whatsapp) : null,
          destination: dto.destination || 'NZ',
          studyLevel: dto.studyLevel || null,
          preferredLanguage: dto.preferredLanguage || null,
          status: initialStatus,
          ipAddress,
        },
      });

      await tx.leadSourceAttribution.create({
        data: {
          leadId: newLead.id,
          source: dto.utmSource ? sanitizeString(dto.utmSource) : null,
          medium: dto.utmMedium ? sanitizeString(dto.utmMedium) : null,
          campaign: dto.utmCampaign ? sanitizeString(dto.utmCampaign) : null,
          referrer: dto.referrer ? sanitizeString(dto.referrer) : null,
          landingPage: dto.landingPage ? sanitizeString(dto.landingPage) : null,
        },
      });

      await tx.consentRecord.create({
        data: {
          leadId: newLead.id,
          type: ConsentType.PRIVACY,
          granted: true,
          ipAddress,
          userAgent: userAgent?.substring(0, 500) || null,
        },
      });

      if (dto.marketingConsent !== undefined) {
        await tx.consentRecord.create({
          data: {
            leadId: newLead.id,
            type: ConsentType.MARKETING,
            granted: !!dto.marketingConsent,
            ipAddress,
            userAgent: userAgent?.substring(0, 500) || null,
          },
        });
      }

      if (hasEmail) {
        plainToken = randomBytes(32).toString('hex');
        const tokenHash = createHash('sha256').update(plainToken).digest('hex');
        await tx.emailVerification.create({
          data: {
            leadId: newLead.id,
            tokenHash,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
      }

      return newLead;
    });

    if (plainToken && normalizedEmail) {
      const token = plainToken;
      const email = normalizedEmail;
      const name = dto.fullName.trim();
      setImmediate(() => {
        this.emailService
          .sendVerificationEmail(email, name, token)
          .catch((err) => this.logger.error('Email send failed', err?.message));
      });
    }

    return {
      id: lead.id,
      status: lead.status,
      emailVerificationRequired: hasEmail,
      message: hasEmail
        ? 'Please check your email to verify your details.'
        : 'Thank you! We will be in touch soon.',
    };
  }

  async getLead(id: string) {
    const lead = await this.prisma.leadCapture.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        whatsapp: true,
        destination: true,
        studyLevel: true,
        preferredLanguage: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        attribution: {
          select: { source: true, medium: true, campaign: true, referrer: true, landingPage: true },
        },
        consents: {
          select: { type: true, granted: true, createdAt: true },
        },
        emailVerification: {
          select: { verifiedAt: true, expiresAt: true },
        },
      },
    });

    if (!lead) throw new NotFoundException('Lead not found.');
    return lead;
  }

  async createHandoff(leadId: string, dto: CreateHandoffDto) {
    const lead = await this.prisma.leadCapture.findUnique({
      where: { id: leadId },
      include: { attribution: true, consents: true, emailVerification: true },
    });

    if (!lead) throw new NotFoundException('Lead not found.');

    const hasPrivacyConsent = lead.consents.some(
      (c) => c.type === ConsentType.PRIVACY && c.granted,
    );
    if (!hasPrivacyConsent) {
      throw new BadRequestException('Lead does not have required privacy consent for handoff.');
    }

    if (
      lead.email &&
      lead.status !== LeadStatus.VERIFIED &&
      lead.status !== LeadStatus.HANDOFF_READY
    ) {
      throw new BadRequestException('Lead email must be verified before handoff.');
    }

    const payload = {
      leadId: lead.id,
      fullName: lead.fullName,
      email: lead.email,
      phone: lead.phone,
      whatsapp: lead.whatsapp,
      destination: lead.destination,
      studyLevel: lead.studyLevel,
      preferredLanguage: lead.preferredLanguage,
      attribution: lead.attribution
        ? { source: lead.attribution.source, medium: lead.attribution.medium, campaign: lead.attribution.campaign }
        : null,
      consents: lead.consents.map((c) => ({ type: c.type, granted: c.granted })),
      notes: dto.notes ? sanitizeString(dto.notes) : null,
      handoffAt: new Date().toISOString(),
    };

    const handoff = await this.prisma.$transaction(async (tx) => {
      const h = await tx.leadHandoff.create({
        data: {
          leadId: lead.id,
          payload,
          status: HandoffStatus.SENT,
          sentAt: new Date(),
          notes: dto.notes ? sanitizeString(dto.notes) : null,
        },
      });
      await tx.leadCapture.update({
        where: { id: lead.id },
        data: { status: LeadStatus.HANDOFF_READY },
      });
      return h;
    });

    return { id: handoff.id, leadId: lead.id, status: handoff.status, sentAt: handoff.sentAt };
  }

  async getHandoff(id: string) {
    const handoff = await this.prisma.leadHandoff.findUnique({
      where: { id },
      select: { id: true, leadId: true, status: true, sentAt: true, createdAt: true, notes: true },
    });
    if (!handoff) throw new NotFoundException('Handoff not found.');
    return handoff;
  }

  async verifyEmail(token: string) {
    if (!token || typeof token !== 'string') {
      throw new BadRequestException('Invalid verification token.');
    }

    if (!/^[a-f0-9]{64}$/.test(token)) {
      throw new BadRequestException('Invalid verification token.');
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');

    const verification = await this.prisma.emailVerification.findUnique({
      where: { tokenHash },
      include: { lead: { select: { id: true, fullName: true } } },
    });

    if (!verification) {
      throw new BadRequestException('Invalid or expired verification token.');
    }

    if (verification.verifiedAt) {
      return {
        message: 'Your email has already been verified.',
        alreadyVerified: true,
        name: verification.lead.fullName,
      };
    }

    if (new Date() > verification.expiresAt) {
      throw new BadRequestException(
        'This verification link has expired. Please contact us to resubmit your enquiry.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.emailVerification.update({ where: { tokenHash }, data: { verifiedAt: new Date() } });
      await tx.leadCapture.update({
        where: { id: verification.leadId },
        data: { status: LeadStatus.VERIFIED },
      });
    });

    return {
      message: 'Your email has been verified successfully. Thank you!',
      alreadyVerified: false,
      name: verification.lead.fullName,
    };
  }
}
