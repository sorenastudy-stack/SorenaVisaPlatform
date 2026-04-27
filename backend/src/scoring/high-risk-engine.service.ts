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
  private normalizeFinancialLevel(level: string | undefined | null): string | null {
    if (!level) return null;
    const map: Record<string, string> = { 'High': 'ABOVE', 'Medium': 'ADEQUATE', 'Low': 'BELOW' };
    return map[level] ?? level;
  }

  assessRisk(intake: any, scoreBand: 'LOW' | 'MID' | 'HIGH'): RiskAssessmentResult {
    const hardBlocks: string[] = [];
    const flaggedIssues: string[] = [];
    let executionAllowed = false;
    let hardStopReason: string | null = null;

    const financialLevel = this.normalizeFinancialLevel(intake.financialLevel);

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

    // FLAG (HIGH risk): Low financial level with budget under 20,000 NZD
    if (
      financialLevel === 'BELOW' &&
      (intake.estimatedBudgetNZD === undefined || intake.estimatedBudgetNZD < 20000)
    ) {
      flaggedIssues.push('Low financial level with budget under 20,000 NZD');
    }

    // FLAG: Unknown visa rejection reason (only relevant if no hard block already)
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
