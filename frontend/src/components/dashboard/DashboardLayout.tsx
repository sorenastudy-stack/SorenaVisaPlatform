import * as React from 'react';

// PR-DASH-1 — Outer layout for the client dashboard.
//
// Off-white page background; centered max-width container with
// responsive horizontal padding. The children compose into a vertical
// stack on mobile and a 2-column grid on `md:` breakpoints and up —
// implemented by the page-level `<DashboardGrid>` wrapper below, not
// by this layout.
export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#faf8f3]">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8 md:py-12">
        {children}
      </div>
    </div>
  );
}

// Vertical stack on mobile; 2-column grid from `md:`.
export function DashboardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {children}
    </div>
  );
}
