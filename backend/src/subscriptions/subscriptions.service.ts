import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';

@Injectable()
export class SubscriptionsService {
  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
  ) {}

  /**
   * Create a new subscription record
   */
  async createSubscription(
    leadId: string,
    plan: 'BASIC' | 'PRO' | 'PREMIUM',
  ) {
    // Verify lead exists
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    // Check if subscription already exists
    let subscription = await this.prisma.subscription.findFirst({
      where: { leadId, status: 'ACTIVE' },
    });

    if (subscription) {
      // Update existing subscription to new plan
      subscription = await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { plan },
      });
    } else {
      // Create new subscription
      subscription = await this.prisma.subscription.create({
        data: {
          leadId,
          plan,
          status: 'ACTIVE',
          stage: 'STAGE_1',
          startDate: new Date(),
        },
      });
    }

    // Emit event
    await this.eventsService.emit(
      'SUBSCRIPTION_CREATED',
      'SUBSCRIPTION',
      subscription.id,
      leadId,
      'SYSTEM',
      null,
      { plan },
    );

    return subscription;
  }

  /**
   * Activate a subscription after payment
   */
  async activateSubscription(
    leadId: string,
    stripeSubscriptionId: string,
  ) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found for lead');
    }

    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'ACTIVE',
        stripeSubscriptionId,
        startDate: new Date(),
      },
    });

    // Emit event
    await this.eventsService.emit(
      'SUBSCRIPTION_ACTIVATED',
      'SUBSCRIPTION',
      updated.id,
      leadId,
      'SYSTEM',
      null,
      { stripeSubscriptionId },
    );

    return updated;
  }

  /**
   * Expire a subscription
   */
  async expireSubscription(leadId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { leadId, status: 'ACTIVE' },
    });

    if (!subscription) {
      throw new NotFoundException('No active subscription found for lead');
    }

    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'EXPIRED',
        plan: 'FREE',
        endDate: new Date(),
      },
    });

    // Emit event
    await this.eventsService.emit(
      'SUBSCRIPTION_EXPIRED',
      'SUBSCRIPTION',
      updated.id,
      leadId,
      'SYSTEM',
      null,
    );

    return updated;
  }

  /**
   * Set free resubmission eligible (ONLY for PREMIUM and no visa decision yet)
   */
  async setFreeResubmissionEligible(leadId: string): Promise<boolean> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { leadId, status: 'ACTIVE' },
    });

    if (!subscription) {
      throw new NotFoundException('No active subscription found for lead');
    }

    // Enforce: ONLY if plan is PREMIUM
    if (subscription.plan !== 'PREMIUM') {
      throw new BadRequestException(
        'Free resubmission is only available for PREMIUM plan',
      );
    }

    // Check if visa decision has already happened
    const applications = await this.prisma.application.findMany({
      where: {
        case: {
          lead: { id: leadId },
        },
      },
    });

    const hasVisaDecision = applications.some(
      (app) =>
        app.status === 'VISA_APPROVED' ||
        app.status === 'VISA_DECLINED',
    );

    if (hasVisaDecision) {
      throw new BadRequestException(
        'Cannot set free resubmission after visa decision has been made',
      );
    }

    // Set eligible
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { freeResubmissionEligible: true },
    });

    // Emit event
    await this.eventsService.emit(
      'FREE_RESUBMISSION_ENABLED',
      'SUBSCRIPTION',
      subscription.id,
      leadId,
      'SYSTEM',
      null,
    );

    return true;
  }

  /**
   * Get active subscription for lead
   */
  async getActiveSubscription(leadId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { leadId, status: 'ACTIVE' },
    });

    if (!subscription) {
      throw new NotFoundException('No active subscription found for lead');
    }

    return subscription;
  }

  /**
   * Get all subscriptions for a lead
   */
  async getSubscriptionsByLead(leadId: string) {
    return this.prisma.subscription.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
