import { Injectable } from '@nestjs/common';

export interface RiskAssessmentResult {
  hardBlocks: string[];
  flaggedIssues: string[];
  executionAllowed: boolean;
  hardStopFlag: boolean;
  hardStopReason: string | null;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
}

@Injectable()
export class HighRiskEngineService {
  /**
   * Assess risk from intake form data
   */
  assessRisk(intake: any, scoreBand: 'LOW' | 'MID' | 'HIGH'): RiskAssessmentResult {
    const hardBlocks: string[] = [];
    const flaggedIssues: string[] = [];
    let executionAllowed = false;
    let hardStopReason: string | null = null;

    // HARD BLOCK 1: Visa rejection history
    if (intake.visaRejectionCount && intake.visaRejectionCount >= 1) {
      hardBlocks.push(`Prior visa rejection (${intake.visaRejectionCount} rejections)`);
    }

    // HARD BLOCK 2: No English test
    if (
      (intake.englishTestType === null || intake.englishTestType === undefined) &&
      (intake.englishOverallScore === null || intake.englishOverallScore === undefined)
    ) {
      hardBlocks.push('No English language test provided');
    }

    // HARD BLOCK 3: Inadequate finances
    if (intake.financialLevel === 'BELOW') {
      hardBlocks.push('Financial level below minimum threshold');
    }

    // FLAG: Unknown visa rejection reason
    if (
      intake.visaRejectionCount &&
      intake.visaRejectionCount > 0 &&
      (!intake.visaRejectionReason || intake.visaRejectionReason === 'UNKNOWN')
    ) {
      flaggedIssues.push('Visa rejection reason is unknown');
    }

    // Determine final status
    if (hardBlocks.length > 0) {
      executionAllowed = false;
      hardStopReason = hardBlocks.join('; ');
    } else {
      // No hard blocks - execution allowed based on score band
      executionAllowed = scoreBand === 'HIGH';
      hardStopReason = null;
    }

    // Determine risk level
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
    if (hardBlocks.length > 0) {
      riskLevel = 'BLOCKED';
    } else if (flaggedIssues.length > 0) {
      riskLevel = 'HIGH';
    } else if (scoreBand === 'LOW') {
      riskLevel = 'MEDIUM';
    } else {
      riskLevel = 'LOW';
    }

    return {
      hardBlocks,
      flaggedIssues,
      executionAllowed,
      hardStopFlag: hardBlocks.length > 0,
      hardStopReason,
      riskLevel,
    };
  }
}
