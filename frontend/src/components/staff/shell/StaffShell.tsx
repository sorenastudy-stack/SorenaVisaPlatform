'use client';

import { StaffProvider } from '@/contexts/StaffContext';
import { StaffSidebar } from './StaffSidebar';
import { StaffBottomTabs } from './StaffBottomTabs';
import { StaffTopBar } from './StaffTopBar';
import { Toaster } from 'sonner';

// PR-CONSULT-2 — Staff dashboard shell.
//
// Top-level layout for every `/staff/*` page. Wraps children with
// the StaffContext provider (so the sidebar, top bar, and inner
// pages all read from the same /api/staff/me snapshot), then
// composes the sidebar / top bar / bottom tabs around a scrollable
// content area. Off-white `#faf8f3` bg per the locked UI rules.
//
// The bottom tab bar adds a 64px gap to the content on mobile so
// nothing is hidden underneath.
export function StaffShell({ children }: { children: React.ReactNode }) {
  return (
    <StaffProvider>
      <div className="flex h-screen bg-[#faf8f3] overflow-hidden">
        <StaffSidebar />
        {/* lg:ml-3 — small off-white seam between the navy sidebar
            and the content column so they don't sit flush. The
            sidebar is hidden below the lg: breakpoint (see
            StaffSidebar), so the margin only kicks in when there's
            a sidebar to separate from. */}
        <div className="flex flex-col flex-1 min-w-0 lg:ml-3">
          <StaffTopBar />
          <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
            {children}
          </main>
        </div>
        <StaffBottomTabs />
      </div>
      <Toaster richColors position="top-right" />
    </StaffProvider>
  );
}
