import { Injectable, BadRequestException } from '@nestjs/common';
import { StripeService } from './stripe.service';

const CONSULTATION_AMOUNTS: Record<string, number> = {
  GAP_CLOSING: 30,
  ADMISSION_CONSULTATION: 50,
  LIA_CONSULTATION: 150,
  ACCOUNT_OPENING: 200,
  FREE_SESSION: 0,
};

@Injectable()
export class PaymentsService {
  constructor(private stripeService: StripeService) {}

  async createConsultationPaymentLink(
    leadId: string,
    consultationType: string,
    amount?: number,
    currency: string = 'nzd',
  ) {
    const amountNZD = amount ?? CONSULTATION_AMOUNTS[consultationType];
    if (amountNZD === undefined) {
      throw new BadRequestException(`Unknown consultation type: ${consultationType}`);
    }
    if (amountNZD === 0) {
      return { url: null, free: true, consultationType };
    }
    const paymentLink = await this.stripeService.createConsultationPaymentLink(
      leadId,
      consultationType,
      amountNZD,
      currency,
    );
    return { url: paymentLink.url, free: false, consultationType };
  }
}
