// PR-LIA-11 — Inline approval-rate bar for the leaderboard table.
//
// Pure HTML/CSS — no Recharts. Saves bundle weight for a primitive
// visual; the chart-heavy lifting is reserved for the actual charts.

export function ApprovalRateBar({ rate }: { rate: number }) {
  const pct = Math.max(0, Math.min(100, rate));
  const tone = pct >= 70
    ? 'bg-emerald-500'
    : pct >= 50
      ? 'bg-[#E8B923]'
      : pct >= 30
        ? 'bg-orange-400'
        : 'bg-red-500';
  return (
    <div className="relative w-full h-5 rounded-md bg-gray-100 overflow-hidden">
      <div
        className={`absolute inset-y-0 left-0 ${tone} transition-[width]`}
        style={{ width: `${pct}%` }}
      />
      <div className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-[#1E3A5F]">
        {pct.toFixed(1)}%
      </div>
    </div>
  );
}
