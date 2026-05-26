// PR-SCORECARD-1 — Routing logic (NEW — not in the Python engine).
//
// Maps band + hard-stop state to the structured ScorecardNextAction
// enum and the English / Persian copy that goes back to the user. The
// engine's legacy `nextAction` string is preserved for the report
// renderer; this module produces the data the modern API consumes.
//
// Rules per the original PR spec:
//   * Any hard stop active → BLOCKED_HARD_STOP, message names the
//     first hard stop + its resolution
//   * Band 1 or 2 → NURTURE_ONLY (no consultation, no booking)
//   * Band 3 → PAY_GAP_CLOSING_SESSION (30 NZD payment then booking)
//   * Bands 4, 5, 6 → BOOK_FREE_15MIN_SESSION (mandatory even at 100)

import type { BandEnum } from './bands';
import type { HardStop } from './hard-stops';

export type ScorecardNextActionValue =
  | 'NURTURE_ONLY'
  | 'PAY_GAP_CLOSING_SESSION'
  | 'BOOK_FREE_15MIN_SESSION'
  | 'BLOCKED_HARD_STOP';

export interface RoutingDecision {
  nextAction: ScorecardNextActionValue;
  nextActionTextEn: string;
  nextActionTextFa: string;
}

export function determineRouting(
  band: BandEnum,
  hardStops: HardStop[],
  _executionEligible: boolean,
): RoutingDecision {
  // Hard stop ALWAYS overrides — even Band 6 with one active hard
  // stop gets BLOCKED_HARD_STOP. The Python engine routes blocked
  // candidates through `Resolve <HS>`; we surface a friendly
  // message instead and keep the structured code on the row.
  if (hardStops.length > 0) {
    const first = hardStops[0];
    return {
      nextAction: 'BLOCKED_HARD_STOP',
      nextActionTextEn:
        `Before we can proceed, we need to resolve: ${first.name}. ${first.resolution}`,
      nextActionTextFa:
        `پیش از ادامه مسیر، ابتدا باید این مورد بررسی شود: ${first.name}. ${first.resolution}`,
    };
  }

  if (band === 'BAND_1' || band === 'BAND_2') {
    return {
      nextAction: 'NURTURE_ONLY',
      nextActionTextEn:
        'We have free educational resources tailored to your profile. We will email you a personalised learning plan.',
      nextActionTextFa:
        'منابع آموزشی رایگان متناسب با پروفایل شما در نظر گرفته شده است. به‌زودی یک برنامه یادگیری شخصی‌سازی‌شده برایتان ایمیل می‌شود.',
    };
  }

  if (band === 'BAND_3') {
    return {
      nextAction: 'PAY_GAP_CLOSING_SESSION',
      nextActionTextEn:
        'Your next step is a 30 NZD Gap-Closing Roadmap Session. On payment, an AI-generated improvement plan and a booking link with a language-matched Admission Specialist will be sent to you.',
      nextActionTextFa:
        'گام بعدی شما یک جلسه ۳۰ دلار نیوزیلندی Gap-Closing Roadmap است. پس از پرداخت، یک برنامه بهبود تولیدشده با هوش مصنوعی و لینک رزرو جلسه با یک Admission Specialist هم‌زبان برایتان ارسال خواهد شد.',
    };
  }

  // Bands 4, 5, 6 — mandatory free 15-min session
  return {
    nextAction: 'BOOK_FREE_15MIN_SESSION',
    nextActionTextEn:
      'You qualify for a free 15-minute consultation with our team. After this mandatory session, you may proceed with the 200 NZD account opening.',
    nextActionTextFa:
      'شما واجد شرایط یک جلسه مشاوره ۱۵ دقیقه‌ای رایگان با تیم ما هستید. پس از این جلسه که برای همه واجدین شرایط الزامی است، می‌توانید با پرداخت ۲۰۰ دلار نیوزیلندی، حساب کاربری خود را فعال کنید.',
  };
}
