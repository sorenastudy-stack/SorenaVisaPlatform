// PR-CRM-LEADS — Status chip for a LeadStatus enum value.
//
// 11 values in the LeadStatus enum (see schema.prisma): NEW,
// CONTACTED, INTAKE_STARTED, INTAKE_COMPLETED, SCORING_DONE,
// QUALIFIED, NURTURE, EXECUTING, CLOSED_WON, CLOSED_LOST,
// DISQUALIFIED. Each gets its own colour band.

export type LeadStatus =
  | 'NEW' | 'CONTACTED' | 'INTAKE_STARTED' | 'INTAKE_COMPLETED'
  | 'SCORING_DONE' | 'QUALIFIED' | 'NURTURE' | 'EXECUTING'
  | 'CLOSED_WON' | 'CLOSED_LOST' | 'DISQUALIFIED';

const STYLES: Record<LeadStatus, string> = {
  NEW:              'bg-[#FAF8F3] text-[#1E3A5F] border-[#1E3A5F]/20',
  CONTACTED:        'bg-blue-50 text-blue-700 border-blue-200',
  INTAKE_STARTED:   'bg-sky-50 text-sky-700 border-sky-200',
  INTAKE_COMPLETED: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  SCORING_DONE:     'bg-indigo-50 text-indigo-700 border-indigo-200',
  QUALIFIED:        'bg-[#E8B923]/10 text-[#1E3A5F] border-[#E8B923]/40',
  NURTURE:          'bg-purple-50 text-purple-700 border-purple-200',
  EXECUTING:        'bg-amber-50 text-amber-800 border-amber-200',
  CLOSED_WON:       'bg-emerald-100 text-emerald-800 border-emerald-200',
  CLOSED_LOST:      'bg-gray-100 text-gray-600 border-gray-300',
  DISQUALIFIED:     'bg-red-50 text-red-700 border-red-200',
};

const LABELS: Record<LeadStatus, string> = {
  NEW:              'New',
  CONTACTED:        'Contacted',
  INTAKE_STARTED:   'Intake started',
  INTAKE_COMPLETED: 'Intake completed',
  SCORING_DONE:     'Scoring done',
  QUALIFIED:        'Qualified',
  NURTURE:          'Nurture',
  EXECUTING:        'Executing',
  CLOSED_WON:       'Closed (won)',
  CLOSED_LOST:      'Closed (lost)',
  DISQUALIFIED:     'Disqualified',
};

export function LeadStatusChip({ status, compact = false }: {
  status: LeadStatus;
  compact?: boolean;
}) {
  const style = STYLES[status] ?? 'bg-gray-100 text-gray-700 border-gray-200';
  return (
    <span className={[
      'inline-flex items-center font-semibold rounded-full border',
      compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-xs',
      style,
    ].join(' ')}>
      {LABELS[status] ?? status}
    </span>
  );
}

export const ALL_LEAD_STATUSES: LeadStatus[] = [
  'NEW', 'CONTACTED', 'INTAKE_STARTED', 'INTAKE_COMPLETED',
  'SCORING_DONE', 'QUALIFIED', 'NURTURE', 'EXECUTING',
  'CLOSED_WON', 'CLOSED_LOST', 'DISQUALIFIED',
];

export function leadStatusLabel(status: LeadStatus): string {
  return LABELS[status] ?? status;
}
