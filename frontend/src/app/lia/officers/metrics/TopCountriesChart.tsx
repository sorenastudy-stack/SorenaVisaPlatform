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

// PR-LIA-11 — Horizontal stacked-bar chart of top countries by case
// volume. Stacked segments per country: approved / declined / pending
// (pending derived = caseCount - approved - declined).

interface CountryRow {
  country: string;
  caseCount: number;
  approvedCount: number;
  declinedCount: number;
}

export function TopCountriesChart({ data }: { data: CountryRow[] }) {
  if (data.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-[#4A4A4A]/70 italic">
        No country data yet — country shows up once cases get a contact with a country recorded.
      </div>
    );
  }

  const rows = data.map((d) => ({
    country: d.country,
    approved: d.approvedCount,
    declined: d.declinedCount,
    pending: Math.max(0, d.caseCount - d.approvedCount - d.declinedCount),
  }));

  // Recharts horizontal bars: use layout="vertical" with a category Y-axis.
  return (
    <div style={{ width: '100%', height: Math.max(220, rows.length * 36 + 60) }}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 10, right: 16, left: 12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11, fill: '#4A4A4A' }} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="country"
            tick={{ fontSize: 11, fill: '#4A4A4A' }}
            width={110}
          />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: '1px solid #1E3A5F33', fontSize: 12 }}
            labelStyle={{ color: '#1E3A5F', fontWeight: 700 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="approved" stackId="a" fill="#059669" name="Approved" />
          <Bar dataKey="declined" stackId="a" fill="#C0392B" name="Declined" />
          <Bar dataKey="pending"  stackId="a" fill="#9CA3AF" name="Pending" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
