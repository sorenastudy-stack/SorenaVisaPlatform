'use client';

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

// PR-LIA-11 — Case stage distribution pie chart.
//
// Colors mirror the stageStyles palette in _utils/format.ts. We hand-
// code them here rather than importing the Tailwind classnames because
// Recharts expects raw hex values.

interface StageRow {
  stage: string;
  count: number;
}

const STAGE_COLORS: Record<string, string> = {
  ADMISSION:     '#3B82F6',  // blue-500
  VISA:          '#8B5CF6',  // violet-500
  INZ_SUBMITTED: '#F3CE49',  // sorena gold
  COMPLETED:     '#059669',  // emerald-600
  WITHDRAWN:     '#6B7280',  // gray-500
};
const FALLBACK_COLOR = '#9CA3AF';

function stageLabelDisplay(s: string): string {
  switch (s) {
    case 'ADMISSION':     return 'Admission';
    case 'VISA':          return 'Visa';
    case 'INZ_SUBMITTED': return 'INZ Submitted';
    case 'COMPLETED':     return 'Completed';
    case 'WITHDRAWN':     return 'Withdrawn';
    default:              return s;
  }
}

export function CaseStagePieChart({ data }: { data: StageRow[] }) {
  if (data.length === 0 || data.every((d) => d.count === 0)) {
    return (
      <div className="py-12 text-center text-sm text-[#4A4A4A]/70 italic">
        No case linkages in the selected window.
      </div>
    );
  }

  const rows = data.map((d) => ({
    name: stageLabelDisplay(d.stage),
    value: d.count,
    stageKey: d.stage,
  }));

  return (
    <div style={{ width: '100%', height: 320 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={rows}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={100}
            innerRadius={50}
            paddingAngle={2}
            label={(entry: { name?: string; value?: number }) => `${entry.name ?? ''}: ${entry.value ?? 0}`}
            labelLine={false}
          >
            {rows.map((r, i) => (
              <Cell key={i} fill={STAGE_COLORS[r.stageKey] ?? FALLBACK_COLOR} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ borderRadius: 12, border: '1px solid #1E3A5F33', fontSize: 12 }}
            labelStyle={{ color: '#1E3A5F', fontWeight: 700 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
