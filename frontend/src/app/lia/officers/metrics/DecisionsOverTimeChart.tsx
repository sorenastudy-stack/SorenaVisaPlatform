'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// PR-LIA-11 — Stacked-bar decisions-over-time chart.
//
// Approved / Declined / Pending stacked per monthLabel. Recharts uses
// browser APIs (refs, ResizeObserver) so this must stay client-side;
// the parent server component passes the pre-computed data array.

interface MonthBucket {
  monthLabel: string;
  monthStart: string;
  approved: number;
  declined: number;
  pending: number;
}

export function DecisionsOverTimeChart({ data }: { data: MonthBucket[] }) {
  const empty = data.every((d) => d.approved === 0 && d.declined === 0 && d.pending === 0);
  if (empty) {
    return (
      <div className="py-12 text-center text-sm text-[#4A4A4A]/70 italic">
        Not enough data yet — check back after more decisions are recorded.
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: 320 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="monthLabel" tick={{ fontSize: 11, fill: '#4A4A4A' }} />
          <YAxis tick={{ fontSize: 11, fill: '#4A4A4A' }} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              borderRadius: 12,
              border: '1px solid #1E3A5F33',
              fontSize: 12,
            }}
            labelStyle={{ color: '#1E3A5F', fontWeight: 700 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="approved" stackId="a" fill="#059669" name="Approved" />
          <Bar dataKey="declined" stackId="a" fill="#C0392B" name="Declined" />
          <Bar dataKey="pending"  stackId="a" fill="#E8B923" name="Pending" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
