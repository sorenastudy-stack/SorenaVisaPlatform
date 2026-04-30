import { Clock, Undo2, ShieldAlert, ArrowRight } from 'lucide-react';

type LeadStatus =
  | 'NEW' | 'CONTACTED' | 'INTAKE_STARTED' | 'INTAKE_COMPLETED' | 'SCORING_DONE'
  | 'QUALIFIED' | 'NURTURE' | 'EXECUTING' | 'CLOSED_WON' | 'CLOSED_LOST'
  | 'DISQUALIFIED';

interface HistoryEntry {
  id: string;
  fromStatus: LeadStatus | null;
  toStatus: LeadStatus;
  reason: string | null;
  isOverride: boolean;
  isUndo: boolean;
  createdAt: string;
  changedBy?: { id: string; name: string | null; email: string };
}

interface Props {
  history: HistoryEntry[];
}

function shortLabel(status: LeadStatus): string {
  return status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-NZ', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  return `${mo}mo ago`;
}

export function LeadStatusHistory({ history }: Props) {
  if (!history || history.length === 0) {
    return (
      <div className="rounded-2xl border border-[#1E3A5F]/10 bg-white p-6">
        <div className="flex items-center gap-2 mb-3">
          <Clock size={16} className="text-[#E8B923]" />
          <h3 className="text-sm font-semibold text-[#1E3A5F]">Status History</h3>
        </div>
        <p className="text-sm text-[#4A4A4A]/60">No status changes yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#1E3A5F]/10 bg-white p-6">
      <div className="flex items-center gap-2 mb-4">
        <Clock size={16} className="text-[#E8B923]" />
        <h3 className="text-sm font-semibold text-[#1E3A5F]">
          Status History <span className="text-[#4A4A4A]/50 font-normal">({history.length})</span>
        </h3>
      </div>

      <ol className="relative border-l-2 border-[#1E3A5F]/10 ml-2 space-y-5">
        {history.map((entry) => {
          const actorName =
            entry.changedBy?.name || entry.changedBy?.email || 'Unknown user';
          return (
            <li key={entry.id} className="ml-4 pl-2">
              <span
                className={`absolute -left-[7px] mt-1.5 w-3 h-3 rounded-full border-2 border-white ${
                  entry.isOverride
                    ? 'bg-orange-500'
                    : entry.isUndo
                    ? 'bg-blue-500'
                    : 'bg-[#E8B923]'
                }`}
                aria-hidden="true"
              />

              <div className="flex flex-wrap items-center gap-2 mb-1">
                {entry.fromStatus ? (
                  <span className="inline-flex items-center gap-1.5 text-sm">
                    <span className="text-[#4A4A4A]/70">
                      {shortLabel(entry.fromStatus)}
                    </span>
                    <ArrowRight size={12} className="text-[#4A4A4A]/40" />
                    <span className="font-semibold text-[#1E3A5F]">
                      {shortLabel(entry.toStatus)}
                    </span>
                  </span>
                ) : (
                  <span className="text-sm font-semibold text-[#1E3A5F]">
                    Created → {shortLabel(entry.toStatus)}
                  </span>
                )}

                {entry.isOverride && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-50 text-orange-700 border border-orange-200">
                    <ShieldAlert size={10} />
                    OVERRIDE
                  </span>
                )}
                {entry.isUndo && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                    <Undo2 size={10} />
                    UNDO
                  </span>
                )}
              </div>

              <p className="text-xs text-[#4A4A4A]/70">
                <span title={formatTime(entry.createdAt)}>{timeAgo(entry.createdAt)}</span>
                {' · '}
                by <span className="text-[#1E3A5F] font-medium">{actorName}</span>
              </p>

              {entry.reason && (
                <p className="mt-1.5 text-sm text-[#4A4A4A] bg-[#FAF8F3] border border-[#1E3A5F]/10 rounded-lg px-3 py-2">
                  <span className="text-[10px] uppercase tracking-wider text-[#4A4A4A]/60 block mb-0.5">
                    Reason
                  </span>
                  {entry.reason}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
