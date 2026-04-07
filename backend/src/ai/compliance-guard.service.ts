import { Injectable } from '@nestjs/common';

@Injectable()
export class ComplianceGuardService {
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

  scan(response: string): string {
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

  injectLiaCta(): string {
    return [
      'For a Licensed Immigration Adviser consultation, please pay 200 NZD by bank transfer.',
      'Kiwibank',
      'SORENASTUDY LIMITED',
      '38-9022-0355698-06',
      'SWIFT KIWINZ22',
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

  private buildSafeResponse(): string {
    const officialReference =
      'This response does not provide immigration advice. Refer to official guidance from Immigration New Zealand: https://www.immigration.govt.nz.';
    const disclaimer =
      'This information is based on official guidance from Immigration New Zealand. For personalised advice consult a Licensed Immigration Adviser.';
    const cta = this.injectLiaCta();

    return `${officialReference}\n\n${disclaimer}\n\n${cta}`;
  }
}
