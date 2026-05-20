// PR-DASH-1 — Lightweight relative-time formatter.
//
// `date-fns` is not in the project's deps; rather than add a whole
// library for one helper we render a few coarse buckets:
//   <60s    → "just now"
//   <60min  → "{N}m ago"
//   <24h    → "{N}h ago"
//   <7d     → "{N}d ago"
//   else    → an absolute ISO-style date "YYYY-MM-DD"
//
// The buckets are intentionally rough — the dashboard activity feed
// is a glanceable list, not a forensic timeline. A future PR can swap
// in `Intl.RelativeTimeFormat` if locale-aware phrasing is needed.
export function formatRelativeTime(input: string | Date): string {
  const ts = typeof input === 'string' ? new Date(input) : input;
  const diffMs = Date.now() - ts.getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) {
    return ts.toISOString().slice(0, 10);
  }
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return ts.toISOString().slice(0, 10);
}
