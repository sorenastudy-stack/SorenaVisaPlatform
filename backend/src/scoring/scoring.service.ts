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

  /**
   * Calculate financial score based on level and budget
   */
  calculateFinancialScore(intake: IntakeFormData): number {
    let score = 0;

    // Financial level scoring (0-60)
    if (intake.financialLevel) {
      const levelScores: Record<string, number> = {
        'ABOVE': 60,
        'ADEQUATE': 40,
        'BELOW': 10,
        'UNCERTAIN': 20,
      };
      score += levelScores[intake.financialLevel] || 0;
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
   * Calculate intent score based on study intent and urgency
   */
  calculateIntentScore(intake: IntakeFormData): number {
    let score = 50; // Base score

    // Intent level scoring
    if (intake.studyIntent) {
      const intentScores: Record<string, number> = {
        'DEFINITE': 30,
        'LIKELY': 20,
        'EXPLORING': 10,
        'TENTATIVE': 5,
      };
      score += intentScores[intake.studyIntent] || 0;
    }

    // Urgency based on preferred start date
    if (intake.preferredStartDate) {
      const now = new Date();
      const monthsUntilStart =
        (intake.preferredStartDate.getFullYear() - now.getFullYear()) * 12 +
        (intake.preferredStartDate.getMonth() - now.getMonth());

      if (monthsUntilStart <= 3) {
        score += 20; // High urgency
      } else if (monthsUntilStart <= 6) {
        score += 10;
      }
    }

    return Math.min(score, 100);
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
   * Determine score band
   */
  determineScoreBand(readinessScore: number): 'LOW' | 'MID' | 'HIGH' {
    if (readinessScore >= 70) return 'HIGH';
    if (readinessScore >= 40) return 'MID';
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

    const scoreBand = this.determineScoreBand(readinessScore);

    return {
      academicScore,
      financialScore,
      englishScore,
      intentScore,
      engagementScore,
      readinessScore,
      scoreBand,
    };
  }
}
