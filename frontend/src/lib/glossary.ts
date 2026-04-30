export type GlossaryEntry = {
  term: string;
  en: string;
  fa: string;
};

export const LEAD_STATUS_GLOSSARY: Record<string, GlossaryEntry> = {
  NEW: {
    term: 'New',
    en: 'Lead just entered the system. No contact has been made yet.',
    fa: 'سرنخ تازه وارد سیستم شده. هنوز تماسی گرفته نشده.',
  },
  CONTACTED: {
    term: 'Contacted',
    en: 'First contact has been made (email, WhatsApp, or phone) and the lead responded.',
    fa: 'اولین تماس گرفته شد (ایمیل، واتساپ یا تلفن) و مشتری پاسخ داد.',
  },
  INTAKE_STARTED: {
    term: 'Intake Started',
    en: 'Collecting initial information from the lead — intake form and basic documents.',
    fa: 'در حال جمع‌آوری اطلاعات اولیه از مشتری — فرم intake و مدارک پایه.',
  },
  INTAKE_COMPLETED: {
    term: 'Intake Completed',
    en: 'All required information has been collected. Ready for scoring.',
    fa: 'تمام اطلاعات لازم جمع شد. آماده‌ی امتیازدهی.',
  },
  SCORING_DONE: {
    term: 'Scoring Done',
    en: 'Readiness score and band have been calculated. Sales decides next move.',
    fa: 'امتیاز و Band مشتری مشخص شد. تیم Sales تصمیم می‌گیرد چه کند.',
  },
  QUALIFIED: {
    term: 'Qualified',
    en: 'Lead meets criteria and is ready to begin case execution.',
    fa: 'مشتری واجد شرایط است و آماده‌ی شروع پرونده.',
  },
  NURTURE: {
    term: 'Nurture',
    en: 'Not ready right now but has potential — kept in marketing funnel for future re-engagement.',
    fa: 'الان آماده نیست ولی پتانسیل دارد — در قیف بازاریابی برای فعال‌سازی بعدی نگه داشته می‌شود.',
  },
  EXECUTING: {
    term: 'Executing',
    en: 'Case is in active execution — operations team is working on documents, applications, and visa.',
    fa: 'پرونده در حال اجراست — تیم اجرایی روی مدارک، اپلای و ویزا کار می‌کند.',
  },
  CLOSED_WON: {
    term: 'Closed — Won',
    en: 'Case closed successfully. Visa granted, university accepted, or service paid in full. Terminal state.',
    fa: 'پرونده با موفقیت بسته شد. ویزا گرفته شد، دانشگاه پذیرش داد، یا سرویس پرداخت کامل شد. وضعیت نهایی.',
  },
  CLOSED_LOST: {
    term: 'Closed — Lost',
    en: 'Case closed unsuccessfully. Lead withdrew, went to a competitor, or execution failed. Terminal state.',
    fa: 'پرونده ناموفق بسته شد. مشتری انصراف داد، به رقیب رفت، یا اجرا شکست خورد. وضعیت نهایی.',
  },
  DISQUALIFIED: {
    term: 'Disqualified',
    en: 'Lead was disqualified — does not meet criteria (with required reason). Terminal state.',
    fa: 'سرنخ رد صلاحیت شد — معیارها را ندارد (با ذکر دلیل اجباری). وضعیت نهایی.',
  },
};

export interface StatusGuide {
  justHappened: string;
  nextStep: string;
  sla: string;
  clientExperience: string;
  warning?: string;
}

export const LEAD_STATUS_GUIDES: Record<string, StatusGuide> = {
  NEW: {
    justHappened: 'Lead entered the pipeline.',
    nextStep: 'Make first contact via WhatsApp, email, or phone.',
    sla: 'First contact within 4 working hours.',
    clientExperience: "Hasn't heard from us yet.",
  },
  CONTACTED: {
    justHappened: 'First contact made and lead responded.',
    nextStep: 'Start the intake form to gather profile, education history, and goals.',
    sla: 'Intake started within 1 working day of contact.',
    clientExperience: 'Knows we exist, expecting next step.',
  },
  INTAKE_STARTED: {
    justHappened: 'Intake form opened with the lead.',
    nextStep: 'Collect all required information and Priority 1 documents.',
    sla: 'Intake completed within 5 working days.',
    clientExperience: 'Filling in forms, uploading documents.',
  },
  INTAKE_COMPLETED: {
    justHappened: 'All intake info gathered.',
    nextStep: 'Run AI scoring to assess readiness.',
    sla: 'Scoring complete within 1 working day.',
    clientExperience: 'Waiting to hear if they qualify.',
  },
  SCORING_DONE: {
    justHappened: 'Readiness score calculated. Decision time.',
    nextStep:
      'Qualify (proceed to execution) | Nurture (not ready, keep warm) | Disqualify (does not meet criteria).',
    sla: 'Decision within 2 working days.',
    clientExperience: 'Waiting for go/no-go.',
    warning: 'Disqualifying requires a written reason and is recorded.',
  },
  QUALIFIED: {
    justHappened: 'Lead approved for case execution.',
    nextStep: 'Move to Executing when the case work actually begins.',
    sla: 'Move to Executing within 3 working days.',
    clientExperience: 'Has been told they are accepted; expects work to start.',
  },
  NURTURE: {
    justHappened: 'Lead is on the long-term marketing track.',
    nextStep:
      'Re-contact periodically; move to Qualified when ready, or Disqualify if no longer viable.',
    sla: 'Touch base every 30 days.',
    clientExperience: 'Receives marketing content; not in active case work.',
  },
  EXECUTING: {
    justHappened: 'Case work in progress (documents, applications, visa).',
    nextStep: 'Close as Won when successful, or Closed Lost if it fails.',
    sla: 'Track against case-level milestones, not lead-level SLA.',
    clientExperience: 'Working with the operations team daily.',
  },
  CLOSED_WON: {
    justHappened: 'Case successful. Visa granted / accepted / paid.',
    nextStep: 'None — this lead is closed.',
    sla: 'Terminal state.',
    clientExperience:
      'Onboarded as a successful client; commission may now be triggered.',
    warning: 'Cannot be reverted by Sales. Only Super Admin can override.',
  },
  CLOSED_LOST: {
    justHappened: 'Case was unsuccessful. Lead withdrew or visa denied.',
    nextStep: 'None — this lead is closed.',
    sla: 'Terminal state.',
    clientExperience: 'Knows the case ended unsuccessfully.',
    warning: 'Cannot be reverted by Sales. Only Super Admin can override.',
  },
  DISQUALIFIED: {
    justHappened: 'Lead does not meet criteria. Reason logged.',
    nextStep: 'None.',
    sla: 'Terminal state.',
    clientExperience: 'Notified that we cannot proceed.',
    warning: 'Cannot be reverted by Sales. Only Super Admin can override.',
  },
};
