import { Injectable } from '@nestjs/common';
import { getFee, calculateFeeBreakdown } from '../payments/fee-config';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

@Injectable()
export class ComplianceGuardService {
  constructor(private readonly settings: PlatformSettingsService) {}

  private blockedPhrases = [
    'your visa will',
    'you are eligible',
    'you will be approved',
    'high chance',
    'guaranteed',
    'you qualify for',
    'i recommend applying for',
    'you can work while studying',
    'your passport is valid enough',
    'you can bring your family',
    'will immigration new zealand approve',
    'what visa should i apply for',
    'should i use an immigration adviser',
    'can you check if i am eligible',
  ];

  // Async because the safe response quotes a live price and live bank details
  // rather than a copy of them. Both callers already sit in async handlers.
  async scan(response: string): Promise<string> {
    const text = response?.toLowerCase() || '';

    if (this.blockedPhrases.some((phrase) => text.includes(phrase))) {
      return this.buildSafeResponse();
    }

    if (this.containsVisaEligibilityInterpretation(text)) {
      return this.buildSafeResponse();
    }

    if (this.containsVisaAdviceQuestion(text)) {
      return this.injectDisclaimer(response);
    }

    return response;
  }

  injectDisclaimer(response: string): string {
    const disclaimer =
      'This information is based on official guidance from Immigration New Zealand. For personalised advice consult a Licensed Immigration Adviser.';
    return `${response.trim()}\n\n${disclaimer}`.trim();
  }

  /**
   * The "talk to an adviser" line an automated answer ends on.
   *
   * Every figure here is read, never written down. It used to say "please pay
   * 200 NZD" with the bank account inline, and all of it was wrong: the LIA
   * consultation is priced in USD, not NZD, and 200 was a third stale number —
   * phase 40 had already found payments.service.ts claiming NZD 150 for this
   * same session and settled it on session-config's figure, but this string was
   * missed. A price quoted by a chatbot is a price a client will hold you to.
   *
   * The bank details come from platform settings, which an admin can edit; the
   * copies that were hardcoded here would have gone stale the moment they did.
   */
  async injectLiaCta(): Promise<string> {
    const fee = getFee('LIA_CONSULTATION');
    const { totalCents } = calculateFeeBreakdown(fee.priceCents, 'bank', fee.currency);
    const amount = `${fee.currency.toUpperCase()} ${(totalCents / 100).toFixed(2)}`;
    const bank = await this.settings.getBankDetails();
    return [
      `For a Licensed Immigration Adviser consultation (${amount} including GST), pay by bank transfer.`,
      bank.bankName,
      bank.accountName,
      bank.accountNumber,
      `SWIFT ${bank.swift}`,
    ].join(' ');
  }

  private containsVisaEligibilityInterpretation(text: string): boolean {
    const eligibilityPatterns = [
      /visa.*eligible/, 
      /eligible.*visa/, 
      /visa.*approved/, 
      /approved.*visa/, 
      /visa.*guaranteed/, 
      /guaranteed.*visa/, 
      /qualify.*visa/, 
      /visa.*qualify/, 
      /high chance.*visa/, 
      /visa.*high chance/, 
      /you will.*visa/, 
      /you are.*eligible/, 
      /you.*qualify.*for/, 
      /chance.*visa/, 
      /chances.*visa/, 
      /should i apply.*visa/, 
      /apply.*visa/, 
      /score.*visa/, 
      /good enough.*visa/, 
      /financial.*visa/, 
      /approve.*application/, 
      /application.*approve/, 
      /visa.*declined/, 
      /declined.*visa/, 
      /passport.*valid.*visa/, 
      /immigration adviser/, 
      /bring.*family.*visa/, 
      /probability.*visa/, 
      /success.*visa/, 
      /criminal record.*visa/, 
      /visa.*criminal record/, 
    ];

    return eligibilityPatterns.some((pattern) => pattern.test(text));
  }

  private containsVisaAdviceQuestion(text: string): boolean {
    const questionPatterns = [
      /should i apply.*visa/, 
      /what visa should i apply for/, 
      /can you guarantee.*visa/, 
      /is my .* score .* visa/, 
      /is my .*good enough .* visa/, 
      /can i work while studying.*visa/, 
      /how long.*visa.*process/, 
      /will my visa refusal/, 
      /can i bring my family/, 
      /what happens if my visa is declined/, 
      /is my passport valid enough for a visa/, 
      /should i use an immigration adviser/, 
      /can you check if i am eligible/, 
      /what is my visa success probability/, 
      /will my criminal record affect my visa/, 
    ];

    return questionPatterns.some((pattern) => pattern.test(text));
  }

  private async buildSafeResponse(): Promise<string> {
    const officialReference =
      'This response does not provide immigration advice. Refer to official guidance from Immigration New Zealand: https://www.immigration.govt.nz.';
    const disclaimer =
      'This information is based on official guidance from Immigration New Zealand. For personalised advice consult a Licensed Immigration Adviser.';
    const cta = await this.injectLiaCta();

    return `${officialReference}\n\n${disclaimer}\n\n${cta}`;
  }
}
