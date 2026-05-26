// PR-LIA-1 — Pure helpers shared across the LIA portal. No deps, no React.

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
export type CaseStage = 'ADMISSION' | 'VISA' | 'COMPLETED' | 'WITHDRAWN';
export type LegalDecision = 'APPROVED' | 'REJECTED' | 'NEEDS_MORE_INFO' | 'WITHDRAWN';
export type DocumentStatus = 'MISSING' | 'PENDING' | 'APPROVED' | 'REJECTED';

export function riskLabel(r: string | null | undefined): string {
  if (!r) return '—';
  return r.charAt(0) + r.slice(1).toLowerCase();
}

export function stageLabel(s: string | null | undefined): string {
  if (!s) return '—';
  return s.charAt(0) + s.slice(1).toLowerCase();
}

export function decisionLabel(d: string | null | undefined): string {
  if (!d) return '—';
  switch (d) {
    case 'APPROVED': return 'Approved';
    case 'REJECTED': return 'Rejected';
    case 'NEEDS_MORE_INFO': return 'Needs more info';
    case 'WITHDRAWN': return 'Withdrawn';
    default: return d;
  }
}

export function riskStyles(r: string | null | undefined): string {
  switch (r) {
    case 'LOW':     return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
    case 'MEDIUM':  return 'bg-amber-100 text-amber-800 border border-amber-200';
    case 'HIGH':    return 'bg-orange-100 text-orange-800 border border-orange-200';
    case 'BLOCKED': return 'bg-red-100 text-red-800 border border-red-200';
    default:        return 'bg-gray-100 text-gray-700 border border-gray-200';
  }
}

export function stageStyles(s: string | null | undefined): string {
  switch (s) {
    case 'ADMISSION': return 'bg-blue-100 text-blue-800 border border-blue-200';
    case 'VISA':      return 'bg-violet-100 text-violet-800 border border-violet-200';
    case 'COMPLETED': return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
    case 'WITHDRAWN': return 'bg-gray-100 text-gray-700 border border-gray-200';
    default:          return 'bg-gray-100 text-gray-700 border border-gray-200';
  }
}

export function decisionStyles(d: string | null | undefined): string {
  switch (d) {
    case 'APPROVED':        return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
    case 'REJECTED':        return 'bg-red-100 text-red-800 border border-red-200';
    case 'NEEDS_MORE_INFO': return 'bg-amber-100 text-amber-800 border border-amber-200';
    case 'WITHDRAWN':       return 'bg-gray-100 text-gray-700 border border-gray-200';
    default:                return 'bg-gray-100 text-gray-700 border border-gray-200';
  }
}

export function docStatusStyles(s: string | null | undefined): string {
  switch (s) {
    case 'APPROVED': return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
    case 'PENDING':  return 'bg-amber-100 text-amber-800 border border-amber-200';
    case 'REJECTED': return 'bg-red-100 text-red-800 border border-red-200';
    case 'MISSING':  return 'bg-gray-100 text-gray-700 border border-gray-200';
    default:         return 'bg-gray-100 text-gray-700 border border-gray-200';
  }
}

const DATE_FMT = new Intl.DateTimeFormat('en-NZ', {
  day: '2-digit', month: 'short', year: 'numeric',
});

const DATE_TIME_FMT = new Intl.DateTimeFormat('en-NZ', {
  day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  return DATE_FMT.format(d);
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  return DATE_TIME_FMT.format(d);
}

export function formatRelative(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  const past = diffMs >= 0;
  const abs = Math.abs(diffMs);
  const minutes = Math.floor(abs / 60_000);
  const hours = Math.floor(abs / 3_600_000);
  const days = Math.floor(abs / 86_400_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return past ? `${minutes}m ago` : `in ${minutes}m`;
  if (hours < 24) return past ? `${hours}h ago` : `in ${hours}h`;
  if (days <= 7) return past ? `${days}d ago` : `in ${days}d`;
  return formatDate(d);
}

// "Escalated" = HIGH or BLOCKED (the LIA's working set).
export function isEscalatedRisk(r: string | null | undefined): boolean {
  return r === 'HIGH' || r === 'BLOCKED';
}

// PR-LIA-3: "5 days" / "Less than a day" / "—" for explicit age
// labels on the case-detail card. Distinct from formatRelative
// (which collapses to "5d ago") because the audience here is reading
// metrics, not narrative timestamps.
export function formatDaysSince(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return 'Less than a day';
  if (diffMs < 86_400_000) return 'Less than a day';
  const days = Math.floor(diffMs / 86_400_000);
  return `${days} day${days === 1 ? '' : 's'}`;
}

// PR-LIA-3: shared thresholds for the productivity report's
// open-cases color badge. Documented in the handover §3.
export function openCasesStyles(count: number): string {
  if (count === 0)     return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
  if (count <= 3)      return 'bg-blue-100 text-blue-800 border border-blue-200';
  if (count <= 7)      return 'bg-amber-100 text-amber-800 border border-amber-200';
  return                      'bg-red-100 text-red-800 border border-red-200';
}
