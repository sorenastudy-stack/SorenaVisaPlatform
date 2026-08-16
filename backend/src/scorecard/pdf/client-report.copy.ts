import { getSessionConfig } from '../../booking/session-config';

// PR-PERSIAN-CLIENT-REPORT — every user-visible string in the client report,
// in both languages.
//
// The ENGLISH side is a verbatim lift of the literals that were previously
// inline in client-report.ts — same wording, same hyphens, same apostrophes.
// That is deliberate and is asserted by a test: an English report rendered
// after this change must be byte-for-byte what it was before, so this refactor
// cannot silently reword the document that clients already receive.
//
// Only `fa` is new. Persian is chosen per client from
// Contact.preferredLanguage, which already stores ISO 639-1 codes ('en', 'fa',
// 'vi'); anything that is not 'fa' renders the English report unchanged.
//
// NOT TRANSLATED HERE, on purpose: `nextActionContent` (heading / lead-in /
// bullets), `bandName` and `bandRange` are produced by the scoring engine and
// stored per submission. They are inventory item 2, which the owner deferred —
// so a Persian report carries English advice text. See §7 of the phase doc.

export type ReportLocale = 'en' | 'fa';

export function resolveReportLocale(preferredLanguage?: string | null): ReportLocale {
  // Mirrors the existing convention in lia-assignment.service.ts.
  return (preferredLanguage ?? 'en').trim().toLowerCase() === 'fa' ? 'fa' : 'en';
}

interface BandMap { BAND_1: string; BAND_2: string; BAND_3: string; BAND_4: string; BAND_5: string; BAND_6: string; DEFAULT: string }

export interface ReportCopy {
  coverSublabel: string;
  coverHeadline: BandMap & { HARD_STOP: string };
  preparedFor: (name: string) => string;
  outOf: string;
  bandLabel: string;
  bandMeaning: BandMap & { HARD_STOP: string };
  sections: {
    readiness: [string, string];
    strengths: [string, string];
    nextSteps: string;
    dualCountry: string;
    about: string;
  };
  intro: { [K in keyof BandMap]: (firstName: string) => string } & { HARD_STOP: (firstName: string) => string };
  categoryNames: Record<1 | 2 | 3 | 4, string>;
  strengthsNote: string;
  pathwayNote: { hardStop: () => string; foundation: string; gapClosing: string; standard: string };
  dualCountry: {
    intro: string;
    nz: { name: string; sub: string; points: string[] };
    my: { name: string; sub: string; points: string[] };
    philosophyLabel: string;
    philosophyHeadline: string;
    philosophyBody: string;
  };
  about: { p1: string; p2: string; closing: string; team: string; credential: string };
  footer: { left: (slogan: string) => string; generated: (date: string) => string; page: (n: number, of: number) => string };
  headerRight: string;
}

const EN: ReportCopy = {
  coverSublabel: 'YOUR PERSONAL PATHWAY RECOMMENDATION',
  coverHeadline: {
    HARD_STOP: 'We have a clear path forward - together',
    BAND_1: 'Thank you for sharing your story',
    BAND_2: 'You have potential - let\'s build on it',
    BAND_3: 'You\'re closer than you think',
    BAND_4: 'Welcome - your pathway is open',
    BAND_5: 'You\'re ready - let\'s move',
    BAND_6: 'You\'re an excellent candidate',
    DEFAULT: '',   // replaced with `Hello {firstName}` by the caller
  },
  preparedFor: (name) => `Prepared for: ${name}`,
  outOf: '/ 100',
  bandLabel: 'YOUR BAND',
  bandMeaning: {
    HARD_STOP: 'Specific factors need legal review before we plan your full pathway.',
    BAND_1: 'Foundations to build before applying. We have a free pathway to support you.',
    BAND_2: 'Workable potential - a few areas to develop before direct application.',
    BAND_3: 'Solid foundation with addressable gaps. A short paid session sharpens your plan.',
    BAND_4: 'You meet the requirements. Time to choose your destination.',
    BAND_5: 'A strong candidate. Priority handling from our team.',
    BAND_6: 'Exceptional profile. Premium handling and the best-matched specialist.',
    DEFAULT: 'Your personalised pathway is in this report.',
  },
  sections: {
    readiness: ['YOUR READINESS', 'A clear picture of where you stand today'],
    strengths: ['YOUR STRENGTHS', 'Areas where your profile already shines'],
    nextSteps: 'YOUR NEXT STEPS',
    dualCountry: 'TWO DESTINATIONS - YOUR CHOICE',
    about: 'ABOUT SORENA VISA',
  },
  intro: {
    HARD_STOP: (n) => `Hello ${n}, thank you for being transparent. Your responses include details that need to be reviewed by a Licensed Immigration Adviser before we can plan a full pathway. This is a protection, not a barrier - most cases like yours have a solution, but a licensed professional must review the specifics first.`,
    BAND_1: (n) => `Hello ${n}, we've carefully read everything you shared. Based on where you are right now, our honest recommendation is to take a little time to build the foundations before applying. This isn't a "no" - it's a "not yet" - and it's the right move. Applying with weak foundations leads to refusals; applying with strong ones leads to acceptances.`,
    BAND_2: (n) => `Hello ${n}, thank you for taking the time to complete our assessment. We see real potential in your profile, and we want to help you turn that potential into a real plan. You're not quite ready for direct application yet, but you're closer than many people realise.`,
    BAND_3: (n) => `Hello ${n}, we've reviewed your profile carefully. You have a workable foundation - there are a few areas to develop, but they're addressable with the right guidance. At this stage, the most valuable thing we can offer you is clarity.`,
    BAND_4: (n) => `Hello ${n}, we've reviewed your profile and we're genuinely pleased. You meet the requirements to move forward, and we're ready to help you take the next step. From here, the path becomes very practical - you're not building foundations any more, you're choosing where to go.`,
    BAND_5: (n) => `Hello ${n}, we've reviewed your profile and you stand out as a strong candidate. The foundations are in place - academically, financially, and personally. At this stage we move quickly: our team will give you priority handling and the best-matched specialist.`,
    BAND_6: (n) => `Hello ${n}, your profile is exceptional. You meet every readiness criterion, and we're honoured to help you take the next step. We'll match you with our best available specialist and prioritise your case across our pipeline.`,
    DEFAULT: (n) => `Hello ${n}, we've received your responses and our team will be in touch with personalised next steps.`,
  },
  categoryNames: {
    1: 'Profile & Migration Stability',
    2: 'Academic & Career Foundation',
    3: 'Financial & Operational Readiness',
    4: 'Immigration & Risk Assessment',
  },
  strengthsNote: 'Every area has room to grow. The areas where you scored highest are your launchpad - the areas where you scored lower are the targets for our next conversation.',
  pathwayNote: {
    hardStop: () => `Your LIA Consultation (${getSessionConfig('LIA').currency} ${getSessionConfig('LIA').price}) is the gate that unlocks the rest. The adviser will review your full history confidentially and identify the safest pathway. Once cleared, every onward step opens up.`,
    foundation: 'The free webinar series and tailored preparation content are no cost to you. We re-assess in 3 to 6 months, when foundations are stronger - so the moment you\'re ready, your path opens.',
    gapClosing: 'The Gap-Closing Roadmap Session is a focused 30-minute consultation with our Admission Specialist. You leave with a structured improvement plan tailored to your profile, plus the answers to your immediate questions.',
    standard: 'Your free 15-minute consultation is no cost, no commitment. We use it to confirm pathway, walk through next steps, and answer any final questions before opening your case file.',
  },
  dualCountry: {
    intro: 'Sorena Visa represents universities, colleges, and polytechnics in both New Zealand and Malaysia. We help students choose the destination that fits their goals, budget, and timeline - and the choice is yours.',
    nz: {
      name: 'New Zealand',
      sub: 'Globally recognised - PR pathway',
      points: [
        'Strong global degree recognition',
        'Post-study work visa (1-3 years)',
        'Clear residency pathway for graduates',
        'Higher tuition and living costs',
        'Longer timeline (4-6 months prep)',
      ],
    },
    my: {
      name: 'Malaysia',
      sub: 'Affordable - Fast start',
      points: [
        'Lower tuition and living costs',
        'Faster admission and visa process',
        'Quality English-medium programmes',
        'Strong regional career opportunities',
        'Easier transition for first-time students',
      ],
    },
    philosophyLabel: 'OUR PHILOSOPHY',
    philosophyHeadline: 'No charge to the student - universities pay us.',
    philosophyBody: 'Sorena is paid directly by the universities and colleges we represent. Our admission and visa-coordination service costs you nothing - we earn only when you succeed, which means our interests are aligned with yours from day one.',
  },
  about: {
    p1: 'Sorena Visa is a New Zealand-based education and immigration consultancy. We\'re authorised agents for universities in New Zealand and Malaysia, helping students secure offers of place, visa approval, and successful settlement abroad.',
    p2: 'Our admission and visa-coordination service is paid by the universities we represent, not by you. That means our interests are aligned with yours from day one - we only succeed when you do.',
    closing: 'If you have any questions, simply reply to the email this report came with. We\'re here to help you make the right choice - not just the fastest one.',
    team: 'The Sorena Visa team',
    credential: 'Licensed Education Counsellor - ICEF Registered Agent - Auckland, New Zealand',
  },
  footer: {
    left: (slogan) => `Sorena Visa - ${slogan}`,
    generated: (date) => `Generated ${date}`,
    page: (n, of) => `Page ${n} of ${of}`,
  },
  headerRight: 'Lead Scoring Report - v2.0',
};

const FA: ReportCopy = {
  coverSublabel: 'مسیر پیشنهادی شخصی شما',
  coverHeadline: {
    HARD_STOP: 'مسیری روشن پیش رو داریم — با هم',
    BAND_1: 'از اینکه داستان خود را با ما در میان گذاشتید سپاسگزاریم',
    BAND_2: 'شما توانمندی دارید — بیایید آن را بسازیم',
    BAND_3: 'از آنچه فکر می‌کنید نزدیک‌تر هستید',
    BAND_4: 'خوش آمدید — مسیر شما باز است',
    BAND_5: 'شما آماده‌اید — حرکت کنیم',
    BAND_6: 'شما داوطلبی برجسته هستید',
    DEFAULT: '',
  },
  preparedFor: (name) => `تهیه‌شده برای: ${name}`,
  outOf: '/ 100',
  bandLabel: 'سطح شما',
  bandMeaning: {
    HARD_STOP: 'پیش از برنامه‌ریزی مسیر کامل شما، بررسی حقوقی برخی موارد لازم است.',
    BAND_1: 'پیش از اقدام، پایه‌هایی باید ساخته شود. مسیری رایگان برای پشتیبانی شما داریم.',
    BAND_2: 'توانمندی قابل اتکا — چند حوزه پیش از اقدام مستقیم نیاز به تقویت دارد.',
    BAND_3: 'پایه‌ای محکم با کاستی‌های قابل رفع. یک جلسه کوتاه، برنامه شما را دقیق‌تر می‌کند.',
    BAND_4: 'شما شرایط لازم را دارید. وقت انتخاب مقصد است.',
    BAND_5: 'داوطلبی قوی. رسیدگی با اولویت از سوی تیم ما.',
    BAND_6: 'پرونده‌ای استثنایی. رسیدگی ویژه و بهترین کارشناس متناسب با شما.',
    DEFAULT: 'مسیر شخصی شما در همین گزارش آمده است.',
  },
  sections: {
    readiness: ['آمادگی شما', 'تصویری روشن از جایگاه امروز شما'],
    strengths: ['نقاط قوت شما', 'حوزه‌هایی که پرونده شما در آن‌ها می‌درخشد'],
    nextSteps: 'قدم‌های بعدی شما',
    dualCountry: 'دو مقصد — انتخاب با شماست',
    about: 'درباره سورنا ویزا',
  },
  intro: {
    HARD_STOP: (n) => `${n} عزیز، از صداقت شما سپاسگزاریم. در پاسخ‌های شما مواردی هست که پیش از برنامه‌ریزی مسیر کامل، باید توسط یک وکیل رسمی مهاجرت بررسی شود. این یک محافظت است، نه یک مانع — بیشتر پرونده‌هایی مانند پرونده شما راه‌حل دارند، اما ابتدا یک متخصص دارای مجوز باید جزئیات را بررسی کند.`,
    BAND_1: (n) => `${n} عزیز، همه آنچه نوشتید را با دقت خواندیم. با توجه به جایگاه امروز شما، پیشنهاد صادقانه ما این است که کمی زمان بگذارید و پیش از اقدام، پایه‌ها را محکم کنید. این «نه» نیست — «هنوز نه» است، و انتخاب درستی است. اقدام با پایه‌های ضعیف به ریجکتی می‌انجامد؛ اقدام با پایه‌های محکم به پذیرش.`,
    BAND_2: (n) => `${n} عزیز، سپاس از اینکه وقت گذاشتید و ارزیابی ما را تکمیل کردید. ما در پرونده شما توانمندی واقعی می‌بینیم و می‌خواهیم کمک کنیم آن را به یک برنامه عملی تبدیل کنید. هنوز برای اقدام مستقیم آماده نیستید، اما از آنچه بسیاری تصور می‌کنند نزدیک‌ترید.`,
    BAND_3: (n) => `${n} عزیز، پرونده شما را با دقت بررسی کردیم. پایه‌ای قابل اتکا دارید — چند حوزه نیاز به تقویت دارد، اما با راهنمایی درست قابل رفع است. در این مرحله، ارزشمندترین چیزی که می‌توانیم به شما بدهیم شفافیت است.`,
    BAND_4: (n) => `${n} عزیز، پرونده شما را بررسی کردیم و واقعاً خرسندیم. شما شرایط لازم برای حرکت رو به جلو را دارید و ما آماده‌ایم در قدم بعدی همراهتان باشیم. از اینجا مسیر کاملاً عملی می‌شود — دیگر در حال ساختن پایه‌ها نیستید، در حال انتخاب مقصد هستید.`,
    BAND_5: (n) => `${n} عزیز، پرونده شما را بررسی کردیم و شما به‌عنوان داوطلبی قوی متمایز هستید. پایه‌ها از نظر تحصیلی، مالی و شخصی فراهم است. در این مرحله سریع حرکت می‌کنیم: تیم ما رسیدگی با اولویت و بهترین کارشناس متناسب را در اختیار شما می‌گذارد.`,
    BAND_6: (n) => `${n} عزیز، پرونده شما استثنایی است. شما همه معیارهای آمادگی را دارید و باعث افتخار ماست که در قدم بعدی همراهتان باشیم. شما را با بهترین کارشناس در دسترس هماهنگ می‌کنیم و پرونده‌تان را در اولویت قرار می‌دهیم.`,
    DEFAULT: (n) => `${n} عزیز، پاسخ‌های شما را دریافت کردیم و تیم ما با قدم‌های بعدیِ شخصی‌سازی‌شده با شما تماس خواهد گرفت.`,
  },
  categoryNames: {
    1: 'پروفایل و ثبات مهاجرتی',
    2: 'پیشینه تحصیلی و شغلی',
    3: 'آمادگی مالی و اجرایی',
    4: 'ارزیابی مهاجرتی و ریسک',
  },
  strengthsNote: 'هر حوزه‌ای جای رشد دارد. حوزه‌هایی که بیشترین امتیاز را گرفته‌اید نقطه پرتاب شما هستند و حوزه‌هایی که امتیاز کمتری گرفته‌اید، موضوع گفت‌وگوی بعدی ما خواهند بود.',
  pathwayNote: {
    // No parentheses — pdfkit does not mirror brackets for RTL, so they render
    // swapped and glued to the wrong words. The fee is set off with commas.
    hardStop: () => `جلسه مشاوره با وکیل رسمی مهاجرت، به مبلغ ${getSessionConfig('LIA').currency} ${getSessionConfig('LIA').price}، دروازه‌ای است که بقیه مسیر را باز می‌کند. وکیل، سوابق کامل شما را محرمانه بررسی می‌کند و امن‌ترین مسیر را مشخص می‌کند. پس از تأیید، همه قدم‌های بعدی باز می‌شود.`,
    foundation: 'مجموعه وبینارهای رایگان و محتوای آمادگیِ متناسب با شما، هیچ هزینه‌ای ندارد. سه تا شش ماه دیگر، وقتی پایه‌ها محکم‌تر شد، دوباره ارزیابی می‌کنیم — تا همان لحظه که آماده شدید، مسیرتان باز شود.',
    gapClosing: 'جلسه نقشه‌راه رفع کاستی‌ها، یک مشاوره متمرکز سی‌دقیقه‌ای با کارشناس پذیرش ماست. با یک برنامه بهبودِ ساختاریافته و متناسب با پرونده خود و نیز پاسخ پرسش‌های فوری‌تان از جلسه بیرون می‌آیید.',
    standard: 'مشاوره رایگان پانزده‌دقیقه‌ای شما بدون هزینه و بدون تعهد است. در این جلسه مسیر را تأیید می‌کنیم، قدم‌های بعدی را مرور می‌کنیم و به پرسش‌های پایانی شما پیش از تشکیل پرونده پاسخ می‌دهیم.',
  },
  dualCountry: {
    intro: 'سورنا ویزا نماینده دانشگاه‌ها، کالج‌ها و پلی‌تکنیک‌ها در نیوزیلند و مالزی است. ما به دانشجویان کمک می‌کنیم مقصدی را انتخاب کنند که با اهداف، بودجه و زمان‌بندی آن‌ها بخواند — و انتخاب با شماست.',
    nz: {
      name: 'نیوزیلند',
      sub: 'اعتبار جهانی — مسیر اقامت دائم',
      points: [
        'اعتبار بالای مدرک در سطح جهانی',
        'ویزای کار پس از تحصیل، 1 تا 3 سال',
        'مسیر روشن اقامت برای فارغ‌التحصیلان',
        'شهریه و هزینه زندگی بالاتر',
        'زمان‌بندی طولانی‌تر، 4 تا 6 ماه آماده‌سازی',
      ],
    },
    my: {
      name: 'مالزی',
      sub: 'مقرون‌به‌صرفه — شروع سریع',
      points: [
        'شهریه و هزینه زندگی کمتر',
        'روند پذیرش و ویزای سریع‌تر',
        'برنامه‌های باکیفیت به زبان انگلیسی',
        'فرصت‌های شغلی قوی در منطقه',
        'انتقال آسان‌تر برای دانشجویان بار اول',
      ],
    },
    philosophyLabel: 'رویکرد ما',
    philosophyHeadline: 'برای دانشجو رایگان است — دانشگاه‌ها به ما پرداخت می‌کنند.',
    philosophyBody: 'هزینه سورنا را مستقیماً دانشگاه‌ها و کالج‌هایی می‌پردازند که نماینده آن‌ها هستیم. خدمات پذیرش و هماهنگی ویزای ما برای شما هیچ هزینه‌ای ندارد — ما تنها زمانی درآمد داریم که شما موفق شوید، و این یعنی منافع ما از روز نخست با منافع شما هم‌راستاست.',
  },
  about: {
    p1: 'سورنا ویزا یک مؤسسه مشاوره تحصیلی و مهاجرتی مستقر در نیوزیلند است. ما نماینده رسمی دانشگاه‌ها در نیوزیلند و مالزی هستیم و به دانشجویان کمک می‌کنیم پذیرش تحصیلی، تأیید ویزا و استقرار موفق در خارج از کشور را به دست آورند.',
    p2: 'هزینه خدمات پذیرش و هماهنگی ویزای ما را دانشگاه‌هایی می‌پردازند که نماینده آن‌ها هستیم، نه شما. یعنی منافع ما از روز نخست با منافع شما هم‌راستاست — ما تنها زمانی موفقیم که شما موفق باشید.',
    closing: 'اگر پرسشی دارید، کافی است به ایمیلی که این گزارش با آن ارسال شده پاسخ دهید. ما اینجاییم تا به شما کمک کنیم انتخاب درست را بکنید — نه فقط سریع‌ترین انتخاب را.',
    team: 'تیم سورنا ویزا',
    credential: 'مشاور تحصیلی دارای مجوز — نماینده رسمی ICEF — اوکلند، نیوزیلند',
  },
  footer: {
    left: (slogan) => `سورنا ویزا — ${slogan}`,
    generated: (date) => `تاریخ صدور: ${date}`,
    page: (n, of) => `صفحه ${n} از ${of}`,
  },
  headerRight: 'گزارش ارزیابی آمادگی — نسخه 2.0',
};

export const REPORT_COPY: Record<ReportLocale, ReportCopy> = { en: EN, fa: FA };
