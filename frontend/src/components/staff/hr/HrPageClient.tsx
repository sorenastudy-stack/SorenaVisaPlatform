'use client';

import { useState } from 'react';
import { Users } from 'lucide-react';
import { MyLeaveClient } from '@/components/staff/leave/MyLeaveClient';
import { MyContractTab } from './MyContractTab';
import { MyJobDescriptionTab } from './MyJobDescriptionTab';

// PR-STAFF-HR (Phase 3) — the staff HR home. One page, in-page tabs (matches
// the Approvals / Case-detail tab pattern). All tabs are self-service and
// scoped server-side to the signed-in staff member. Ungated: every staff role.

type Tab = 'leave' | 'contract' | 'jobDescription';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'leave', label: 'My Leave' },
  { id: 'contract', label: 'My Contract' },
  { id: 'jobDescription', label: 'My Job Description' },
];

export function HrPageClient() {
  const [tab, setTab] = useState<Tab>('leave');

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-4 flex items-center gap-2">
        <Users size={20} className="text-sorena-navy" />
        <h1 className="text-2xl font-bold text-sorena-navy">HR</h1>
      </div>

      <div className="-mx-1 mb-6 overflow-x-auto border-b border-gray-200">
        <div className="flex min-w-max gap-1 px-1">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={[
                  'px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors min-h-[48px]',
                  active ? 'border-[#F3CE49] text-[#1e3a5f]' : 'border-transparent text-gray-500 hover:text-[#1e3a5f]',
                ].join(' ')}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'leave' && <MyLeaveClient />}
      {tab === 'contract' && <MyContractTab />}
      {tab === 'jobDescription' && <MyJobDescriptionTab />}
    </div>
  );
}
