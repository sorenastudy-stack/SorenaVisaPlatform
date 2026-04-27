import { Injectable } from '@nestjs/common';

export interface IntakeFormData {
  highestQualification?: string;
  fieldOfStudy?: string;
  gpa?: number;
  englishTestType?: string;
  englishOverallScore?: number;
  englishComponentScores?: Record<string, number>;
  financialLevel?: string;
  estimatedBudgetNZD?: number;
  visaHistory?: string;
  visaRejectionCount?: number;
  visaRejectionReason?: string;
  workExperienceYears?: number;
  studyIntent?: string;
  preferredStartDate?: Date;
  preferredLevel?: string;
  preferredField?: string;
  completionPercent?: number;
}

export interface ScoreResult {
  academicScore: number;
  financialScore: number;
  englishScore: number;
  intentScore: number;
  engagementScore: number;
  readinessScore: number;
  bandNumber: number;
  scoreBand: 'LOW' | 'MID' | 'HIGH';
}

@Injectable()
export class ScoringService {
  /**
   * Calculate academic score based on qualification, GPA, and field relevance
   */
  calculateAcademicScore(intake: IntakeFormData): number {
    let score = 0;

    // Qualification scoring (0-40)
    if (intake.highestQualification) {
      const qualScores: Record<string, number> = {
        'PHD': 40,
        'MASTER': 35,
        'BACHELOR': 25,
        'GRADUATE_DIPLOMA': 20,
        'POSTGRADUATE_CERTIFICATE': 18,
        'GRADUATE_CERTIFICATE': 15,
        'DIPLOMA': 10,
      };
      score += qualScores[intake.highestQualification] || 0;
    }

    // GPA scoring (0-40)
    if (intake.gpa !== undefined) {
      // Assuming 4.0 scale
      score += Math.min((intake.gpa / 4) * 40, 40);
    }

    // Field relevance (0-20) - if field matches STEM
    if (intake.fieldOfStudy) {
      const stemFields = ['engineering', 'science', 'technology', 'mathematics', 'computer'];
      const isStem = stemFields.some(field =>
        intake.fieldOfStudy?.toLowerCase().includes(field),
      );
      if (isStem) score += 20;
    }

    return Math.min(score, 100);
  }

  private normalizeFinancialLevel(level: string): string {
    const map: Record<string, string> = {
      'High': 'ABOVE',
      'Medium': 'ADEQUATE',
      'Low': 'BELOW',
    };
    return map[level] ?? level;
  }

  /**
   * Calculate financial score based on level and budget
   */
  calculateFinancialScore(intake: IntakeFormData): number {
    let score = 0;

    // Financial level scoring (0-60)
    if (intake.financialLevel) {
      const normalized = this.normalizeFinancialLevel(intake.financialLevel);
      const levelScores: Record<string, number> = {
        'ABOVE': 60,
        'ADEQUATE': 40,
        'BELOW': 10,
        'UNCERTAIN': 20,
      };
      score += levelScores[normalized] || 0;
    }

    // Budget scoring (0-40)
    if (intake.estimatedBudgetNZD !== undefined) {
      // NZD 25k-30k per year is typical
      if (intake.estimatedBudgetNZD >= 25000) {
        score += 40;
      } else if (intake.estimatedBudgetNZD >= 15000) {
        score += 25;
      } else if (intake.estimatedBudgetNZD > 0) {
        score += 10;
      }
    }

    return Math.min(score, 100);
  }

  /**
   * Calculate English score based on test type and overall score
   */
  calculateEnglishScore(intake: IntakeFormData): number {
    let score = 0;

    if (!intake.englishTestType || intake.englishOverallScore === undefined) {
      return 0; // No English test = no score
    }

    // Overall score normalization (0-100)
    const testScoreRanges: Record<string, { max: number; weight: number }> = {
      'IELTS': { max: 9, weight: 100 / 9 },
      'TOEFL': { max: 120, weight: 100 / 120 },
      'PTE': { max: 90, weight: 100 / 90 },
      'DUOLINGO': { max: 160, weight: 100 / 160 },
      'C1_ADVANCED': { max: 230, weight: 100 / 230 },
    };

    const range = testScoreRanges[intake.englishTestType];
    if (range) {
      score = Math.min((intake.englishOverallScore / range.max) * 100, 100);
    }

    return score;
  }

  /**
   * Calculate intent score based on free-text length and quality
   */
  calculateIntentScore(intake: IntakeFormData): number {
    const len = (intake.studyIntent || '').trim().length;
    if (len === 0) return 0;
    if (len < 20) return 30;
    if (len < 100) return 50;
    if (len <= 200) return 70;
    return 90;
  }

  /**
   * Calculate engagement score based on intake form completion
   */
  calculateEngagementScore(completionPercent: number): number {
    // Direct mapping of completion % to engagement score
    return Math.min(completionPercent, 100);
  }

  /**
   * Calculate composite readiness score with weighted average
   */
  calculateReadinessScore(scores: {
    academic: number;
    financial: number;
    english: number;
    intent: number;
    engagement: number;
  }): number {
    // Weights sum to 1.0
    const weights = {
      academic: 0.25,
      financial: 0.25,
      english: 0.2,
      intent: 0.15,
      engagement: 0.15,
    };

    const readiness =
      scores.academic * weights.academic +
      scores.financial * weights.financial +
      scores.english * weights.english +
      scores.intent * weights.intent +
      scores.engagement * weights.engagement;

    return Math.round(readiness);
  }

  /**
   * Map readiness score to 6-band numeric tier (v3.0 spec)
   */
  determineBandNumber(readinessScore: number): number {
    if (readinessScore >= 85) return 6;
    if (readinessScore >= 70) return 5;
    if (readinessScore >= 55) return 4;
    if (readinessScore >= 40) return 3;
    if (readinessScore >= 25) return 2;
    return 1;
  }

  /**
   * Map band number to DB-compatible 3-value ScoreBand enum
   * Band 1-2 → LOW, 3-4 → MID, 5-6 → HIGH
   */
  determineScoreBand(bandNumber: number): 'LOW' | 'MID' | 'HIGH' {
    if (bandNumber >= 5) return 'HIGH';
    if (bandNumber >= 3) return 'MID';
    return 'LOW';
  }

  /**
   * Calculate all scores from intake form
   */
  calculateScores(intake: IntakeFormData): ScoreResult {
    const academicScore = this.calculateAcademicScore(intake);
    const financialScore = this.calculateFinancialScore(intake);
    const englishScore = this.calculateEnglishScore(intake);
    const intentScore = this.calculateIntentScore(intake);
    const engagementScore = this.calculateEngagementScore(
      intake.completionPercent || 0,
    );

    const readinessScore = this.calculateReadinessScore({
      academic: academicScore,
      financial: financialScore,
      english: englishScore,
      intent: intentScore,
      engagement: engagementScore,
    });

    const bandNumber = this.determineBandNumber(readinessScore);
    const scoreBand = this.determineScoreBand(bandNumber);

    return {
      academicScore,
      financialScore,
      englishScore,
      intentScore,
      engagementScore,
      readinessScore,
      bandNumber,
      scoreBand,
    };
  }
}
