// PR-SCORECARD-2 — Bilingual labels for the public scorecard surface.
//
// Why this file (and not next-intl keys): the questionnaire alone has
// 53 questions × multiple options × 2 languages. Inflating en.json /
// fa.json by ~2000 keys is unwieldy and the existing CRM pages already
// mix patterns (some hardcoded English, some i18n keys). This file is
// the single source of truth for every user-facing string on the
// public scorecard pages.
//
// The Persian translations for the Malaysia callout are EXACTLY as
// specified in the PR-SCORECARD-2 brief — do not paraphrase.

export type Locale = 'en' | 'fa';

export interface BilingualString {
  en: string;
  fa: string;
}

export const T = (s: BilingualString, locale: Locale) => s[locale];

// Convenience: inline a bilingual string at the call site.
export const b = (en: string, fa: string): BilingualString => ({ en, fa });

// ─── LANDING PAGE ────────────────────────────────────────────────────

export const LANDING_STRINGS = {
  heroTagline:    b('Take the free readiness assessment', 'ارزیابی رایگان آمادگی خود را انجام دهید'),
  heroTitle:      b('Discover your path to studying in New Zealand', 'مسیر خود برای تحصیل در نیوزیلند را کشف کنید'),
  heroSubtitle:   b(
    'A 10-minute, 100-point assessment that scores your profile across 4 dimensions and gives you a personalised next step.',
    'ارزیابی ۱۰ دقیقه‌ای و ۱۰۰ امتیازی که پروفایل شما را در ۴ بعد بررسی می‌کند و یک گام بعدی شخصی‌سازی‌شده ارائه می‌دهد.',
  ),
  heroCta:        b('Start free assessment →', 'شروع ارزیابی رایگان →'),
  valueCard1Title: b('10-minute assessment', 'ارزیابی ۱۰ دقیقه‌ای'),
  valueCard1Body:  b('53 short questions across profile, academic, financial, and risk dimensions.',
                    '۵۳ پرسش کوتاه در ابعاد پروفایل، تحصیلی، مالی و ریسک.'),
  valueCard2Title: b('Personalised pathway', 'مسیر شخصی‌سازی‌شده'),
  valueCard2Body:  b('We map your score to one of 6 readiness bands and a concrete next action — not a sales pitch.',
                    'امتیاز شما به یکی از ۶ سطح آمادگی نگاشت می‌شود و یک گام بعدی مشخص ارائه می‌دهیم — نه فروش.'),
  valueCard3Title: b('Zero cost to start', 'بدون هزینه برای شروع'),
  valueCard3Body:  b('The assessment is free. If you reach the top bands, our consultation is free too.',
                    'ارزیابی رایگان است. اگر به سطوح بالا برسید، مشاوره ما نیز رایگان است.'),
  trustAuthorizedAgent: b(
    'Sorena Visa is an authorised agent for New Zealand and Malaysian universities.',
    'سورنا ویزا به‌عنوان ایجنت رسمی دانشگاه‌های نیوزیلند و مالزی فعالیت می‌کند.',
  ),
  signinHint: b('Already have an account?', 'حساب کاربری دارید؟'),
  signinLink: b('Sign in', 'ورود'),
};

// ─── FORM SECTIONS ───────────────────────────────────────────────────

export const FORM_SECTIONS = [
  {
    id: 0,
    title: b('Your details', 'مشخصات شما'),
    description: b('We need a way to send you your results.', 'برای ارسال نتایج به شما نیاز داریم.'),
    maxPoints: 0,
  },
  {
    id: 1,
    title: b('Profile & migration stability', 'پروفایل و ثبات مهاجرتی'),
    description: b('Basics about you, your family, and your travel history.', 'اطلاعات پایه درباره شما، خانواده و سابقه سفر.'),
    maxPoints: 20,
  },
  {
    id: 2,
    title: b('Academic & career foundation', 'بنیه تحصیلی و شغلی'),
    description: b('Your qualifications, English level, and career trajectory.', 'مدارک تحصیلی، سطح زبان انگلیسی و مسیر شغلی شما.'),
    maxPoints: 35,
  },
  {
    id: 3,
    title: b('Financial & operational readiness', 'آمادگی مالی و عملیاتی'),
    description: b('Funds, documents, and how soon you can act.', 'سرمایه، مدارک و سرعت آمادگی شما.'),
    maxPoints: 25,
  },
  {
    id: 4,
    title: b('Immigration & risk assessment', 'ارزیابی مهاجرتی و ریسک'),
    description: b('Past visa history, medical, and identity questions.', 'سابقه ویزا، سلامت و سؤالات هویتی.'),
    maxPoints: 20,
  },
];

// ─── FORM UI LABELS ──────────────────────────────────────────────────

export const FORM_UI = {
  progressLabel:    b('Step {current} of {total}', 'مرحله {current} از {total}'),
  next:             b('Save & next →', 'ذخیره و ادامه →'),
  previous:         b('← Previous', '→ قبلی'),
  submit:           b('Submit assessment', 'ارسال ارزیابی'),
  submitting:       b('Submitting…', 'در حال ارسال…'),
  saving:           b('Saving…', 'در حال ذخیره…'),
  saved:            b('Saved', 'ذخیره شد'),
  saveErrorBanner:  b('Could not save — please check your connection and try again.',
                     'ذخیره ممکن نشد — لطفاً اتصال خود را بررسی کنید و دوباره تلاش کنید.'),
  fieldRequired:    b('This field is required.', 'این فیلد الزامی است.'),
  invalidEmail:     b('Please enter a valid email address.', 'لطفاً یک ایمیل معتبر وارد کنید.'),
  invalidPhone:     b('Phone must start with + and the country code.', 'شماره تلفن باید با + و کد کشور شروع شود.'),
  conditionalSkip:  b('Based on your previous answer, the next questions are not relevant.',
                     'بر اساس پاسخ قبلی شما، پرسش‌های بعدی به این مورد مربوط نیست.'),
  declarationTitle: b('Declaration & consent', 'اظهارنامه و رضایت'),
  declarationBody:  b(
    'I confirm that the information I have provided is accurate to the best of my knowledge. I understand that Sorena Visa will store and process this information to generate my readiness assessment and may contact me about the results.',
    'تأیید می‌کنم که اطلاعات ارائه‌شده تا حد دانش من صحیح است. متوجه هستم که سورنا ویزا این اطلاعات را برای تولید ارزیابی آمادگی من ذخیره و پردازش می‌کند و ممکن است در مورد نتایج با من تماس بگیرد.',
  ),
  declarationAgree: b('I agree', 'موافقم'),
  resumeBanner:     b('We restored your in-progress assessment.', 'ارزیابی نیمه‌تمام شما بازیابی شد.'),
};

// ─── RESULT PAGE ─────────────────────────────────────────────────────

export const RESULT_STRINGS = {
  headerTitle:      b('Your assessment result', 'نتیجه ارزیابی شما'),
  generatedOn:      b('Generated on {date}', 'تولید شده در {date}'),
  totalScoreLabel:  b('Total score', 'امتیاز کل'),
  bandLabel:        b('Band', 'سطح'),
  executionEligible: b('Execution eligible', 'واجد شرایط اجرا'),
  notYetEligible:    b('Not yet eligible', 'هنوز واجد شرایط نیست'),
  hardStopsTitle:    b('Hard stops', 'موانع جدی'),
  riskFlagsTitle:    b('Risk flags', 'هشدارهای ریسک'),
  fiveGateTitle:     b('Execution eligibility — 5-gate check', 'واجد شرایط بودن — بررسی ۵ دروازه'),
  categoryBreakdown: b('Category breakdown', 'تفکیک امتیاز در دسته‌ها'),
  nextActionTitle:   b('Your next best action', 'بهترین گام بعدی شما'),
  malaysiaCalloutTitle: b('You also qualify for Malaysia', 'شما واجد شرایط مالزی نیز هستید'),
  malaysiaCalloutBody: b(
    'You are eligible for both New Zealand AND Malaysia. As a Sorena-certified agent for both countries, we charge no service fees — universities pay us a commission upon successful enrollment. You only pay the INZ visa fee + our one-time USD 200 account opening fee.',
    'شما واجد شرایط هر دو کشور نیوزیلند و مالزی هستید. سورنا ویزا به‌عنوان ایجنت رسمی هر دو کشور، هیچ هزینه خدماتی از شما دریافت نمی‌کند — دانشگاه‌ها در صورت ثبت‌نام موفق، کمیسیون ما را پرداخت می‌کنند. شما فقط هزینه ویزای INZ و مبلغ یک‌بار ۲۰۰ دلار آمریکا برای افتتاح حساب در پلتفرم سورنا را پرداخت می‌کنید.',
  ),
  bookFreeCta:       b('Book your free 15-minute consultation', 'مشاوره رایگان ۱۵ دقیقه‌ای خود را رزرو کنید'),
  bookFreeBackChannel: b('Your case advisor will email you within 24 hours to schedule.',
                          'مشاور پرونده شما ظرف ۲۴ ساعت برای زمان‌بندی با شما تماس می‌گیرد.'),
  payGapTitle:       b('Your next step: Gap-Closing Roadmap Session', 'گام بعدی شما: جلسه نقشه راه رفع شکاف'),
  payGapAmount:      b('NZD 30', 'NZD 30'),
  payGapBody:        b(
    'Once payment is received, you will receive a personalised AI-generated improvement plan and a booking link with a language-matched specialist.',
    'پس از دریافت پرداخت، یک برنامه بهبود شخصی‌سازی‌شده توسط هوش مصنوعی و یک لینک رزرو با متخصص هم‌زبان خود دریافت خواهید کرد.',
  ),
  payGapCta:         b('Pay 30 NZD', 'پرداخت ۳۰ NZD'),
  payGapComingSoon:  b('Payment system coming soon. Your advisor will contact you to arrange this.',
                      'سیستم پرداخت به‌زودی فعال می‌شود. مشاور شما برای ترتیب پرداخت تماس می‌گیرد.'),
  nurtureTitle:      b('We have designed a learning pathway tailored to your profile', 'یک مسیر یادگیری متناسب با پروفایل شما طراحی کرده‌ایم'),
  nurtureBody:       b(
    'Free resources to help you build readiness over the next 3-6 months. We will email you a personalised learning plan.',
    'منابع رایگان برای کمک به آمادگی شما در ۳ تا ۶ ماه آینده. یک برنامه یادگیری شخصی‌سازی‌شده برای شما ایمیل می‌کنیم.',
  ),
  blockedTitle:      b('There is a blocker on your profile', 'یک مانع روی پروفایل شما وجود دارد'),
  blockedBody:       b('Please review the hard stops below — your case advisor will reach out to discuss how to resolve them.',
                       'لطفاً موانع زیر را مرور کنید — مشاور پرونده شما برای بحث درباره راه‌حل با شما تماس می‌گیرد.'),
  fullAnswerLog:     b('Full answer log', 'دفترچه کامل پاسخ‌ها'),
  downloadPdfCta:    b('Download report (PDF)', 'دانلود گزارش (PDF)'),
  pdfComingSoon:     b('PDF download coming soon. Your case advisor has a copy.',
                      'دانلود PDF به‌زودی فعال می‌شود. مشاور پرونده شما یک نسخه دارد.'),
  backToDashboard:   b('Back to dashboard', 'بازگشت به داشبورد'),
  bookingRecorded:   b('Booking link opened. Your case advisor has been notified.', 'لینک رزرو باز شد. مشاور پرونده شما مطلع شده است.'),
};

// ─── BAND DISPLAY METADATA ───────────────────────────────────────────

export const BAND_META: Record<string, { name: BilingualString; range: string; color: string }> = {
  BAND_1: { name: b('Cold / Unready', 'سرد / آماده نیست'),                 range: '0-24',   color: 'gray' },
  BAND_2: { name: b('Early Stage / Fragile', 'مرحله اولیه / شکننده'),       range: '25-39',  color: 'blue' },
  BAND_3: { name: b('Developing / Consultable', 'در حال توسعه / قابل مشاوره'), range: '40-54',  color: 'amber' },
  BAND_4: { name: b('Viable / Structured Opportunity', 'قابل اجرا / فرصت ساختاریافته'), range: '55-69',  color: 'orange' },
  BAND_5: { name: b('Strong / Near Execution Ready', 'قوی / نزدیک به آماده اجرا'),       range: '70-84',  color: 'violet' },
  BAND_6: { name: b('Premium / Execution Ready', 'برتر / آماده اجرا'),     range: '85-100', color: 'emerald' },
};

export const CATEGORY_META: Record<number, { name: BilingualString; max: number }> = {
  1: { name: b('Profile & migration stability',         'پروفایل و ثبات مهاجرتی'),       max: 20 },
  2: { name: b('Academic & career foundation',          'بنیه تحصیلی و شغلی'),          max: 35 },
  3: { name: b('Financial & operational readiness',     'آمادگی مالی و عملیاتی'),        max: 25 },
  4: { name: b('Immigration & risk assessment',         'ارزیابی مهاجرتی و ریسک'),       max: 20 },
};
