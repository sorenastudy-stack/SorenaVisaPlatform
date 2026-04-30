import { Check } from 'lucide-react';
import { LEAD_STATUS_GLOSSARY } from '@/lib/glossary';
import { InfoTip } from '@/components/ui/InfoTip';

type LeadStatus =
  | 'NEW' | 'CONTACTED' | 'INTAKE_STARTED' | 'INTAKE_COMPLETED' | 'SCORING_DONE'
  | 'QUALIFIED' | 'NURTURE' | 'EXECUTING' | 'CLOSED_WON' | 'CLOSED_LOST'
  | 'DISQUALIFIED';

interface HistoryEntry {
  id: string;
  fromStatus: LeadStatus | null;
  toStatus: LeadStatus;
  createdAt: string;
  isOverride: boolean;
  isUndo: boolean;
  changedBy?: { id: string; name: string | null; email: string };
}

interface Props {
  currentStatus: LeadStatus;
  history: HistoryEntry[];
}

const MAIN_PATH: LeadStatus[] = [
  'NEW',
  'CONTACTED',
  'INTAKE_STARTED',
  'INTAKE_COMPLETED',
  'SCORING_DONE',
  'QUALIFIED',
  'EXECUTING',
  'CLOSED_WON',
];

const BRANCHES: { status: LeadStatus; tone: 'nurture' | 'lost' | 'disq' }[] = [
  { status: 'NURTURE', tone: 'nurture' },
  { status: 'CLOSED_LOST', tone: 'lost' },
  { status: 'DISQUALIFIED', tone: 'disq' },
];

const branchToneStyles: Record<string, string> = {
  nurture: 'bg-purple-50 text-purple-700 border-purple-200',
  lost: 'bg-gray-100 text-gray-600 border-gray-200',
  disq: 'bg-red-50 text-red-700 border-red-200',
};

function shortLabel(status: LeadStatus): string {
  return status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function LeadProgressTimeline({ currentStatus, history }: Props) {
  const visitedStatuses = new Set<LeadStatus>([currentStatus]);
  for (const h of history) {
    if (h.fromStatus) visitedStatuses.add(h.fromStatus);
    visitedStatuses.add(h.toStatus);
  }

  const currentMainIndex = MAIN_PATH.indexOf(currentStatus);
  const isOnBranch = currentMainIndex === -1;

  const stepState = (status: LeadStatus, index: number): 'done' | 'current' | 'future' => {
    if (status === currentStatus) return 'current';
    if (isOnBranch) {
      return visitedStatuses.has(status) ? 'done' : 'future';
    }
    if (index < currentMainIndex) return 'done';
    return 'future';
  };

  const isBranchActive = (status: LeadStatus) => status === currentStatus;

  return (
    <div className="bg-white border border-[#1E3A5F]/10 rounded-2xl p-6 mb-6">
      <h3 className="text-sm font-semibold text-[#1E3A5F] mb-4">Lead Progress</h3>

      {/* Main path */}
      <div className="overflow-x-auto pb-2">
        <div className="flex items-center gap-2 min-w-max">
          {MAIN_PATH.map((status, i) => {
            const state = stepState(status, i);
            const entry = LEAD_STATUS_GLOSSARY[status];
            return (
              <div key={status} className="flex items-center gap-2">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-colors ${
                      state === 'done'
                        ? 'bg-[#E8B923] border-[#E8B923] text-white'
                        : state === 'current'
                        ? 'bg-[#1E3A5F] border-[#1E3A5F] text-white ring-4 ring-[#E8B923]/30'
                        : 'bg-white border-[#1E3A5F]/20 text-[#1E3A5F]/40'
                    }`}
                  >
                    {state === 'done' ? (
                      <Check size={16} strokeWidth={3} />
                    ) : (
                      <span className="text-xs font-bold">{i + 1}</span>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1">
                    <span
                      className={`text-[11px] font-medium whitespace-nowrap ${
                        state === 'current'
                          ? 'text-[#1E3A5F]'
                          : state === 'done'
                          ? 'text-[#1E3A5F]/80'
                          : 'text-[#1E3A5F]/40'
                      }`}
                    >
                      {shortLabel(status)}
                    </span>
                    {entry && <InfoTip entry={entry} iconSize={12} />}
                  </div>
                </div>

                {/* Connector */}
                {i < MAIN_PATH.length - 1 && (
                  <div
                    className={`h-0.5 w-10 sm:w-16 -mt-5 transition-colors ${
                      stepState(MAIN_PATH[i + 1], i + 1) === 'done' ||
                      MAIN_PATH[i + 1] === currentStatus
                        ? 'bg-[#E8B923]'
                        : 'bg-[#1E3A5F]/15'
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Branches */}
      <div className="mt-6 pt-5 border-t border-[#1E3A5F]/10">
        <p className="text-xs text-[#4A4A4A]/60 mb-3">Alternative outcomes</p>
        <div className="flex flex-wrap gap-2">
          {BRANCHES.map(({ status, tone }) => {
            const active = isBranchActive(status);
            const entry = LEAD_STATUS_GLOSSARY[status];
            return (
              <span
                key={status}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                  active
                    ? 'ring-2 ring-[#E8B923]/40 ' + branchToneStyles[tone]
                    : `${branchToneStyles[tone]} opacity-50`
                }`}
              >
                {shortLabel(status)}
                {entry && <InfoTip entry={entry} iconSize={12} />}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
