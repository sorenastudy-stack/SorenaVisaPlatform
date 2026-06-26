'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useStaff } from '@/contexts/StaffContext';
import { PendingApprovalsList } from './PendingApprovalsList';
import { MyRequestsList } from './MyRequestsList';

// PR-CONSULT-3 — Approvals page client.
//
// Two tabs:
//   - Pending  — OWNER only (canApprove). Lists owner-approval queue.
//   - Mine     — SUPER_ADMIN view of their own requests. OWNER also
//                gets it so an OWNER who's been promoted from
//                SUPER_ADMIN can see history.
//
// Initial tab can be set via ?tab=mine (the "Sent for owner
// approval" toast deep-links to that view).

type Tab = 'pending' | 'mine';

export function ApprovalsPageClient() {
  const t = useTranslations();
  const { me, permissions } = useStaff();
  const searchParams = useSearchParams();

  const canApprove = permissions.canApprove;
  // SUPER_ADMIN and OWNER both can use the Mine tab. ADMIN below
  // never reaches this page (route-level redirect).
  const canSeeMine = me?.role === 'SUPER_ADMIN' || me?.role === 'OWNER';

  // Default tab: OWNER lands on Pending; SUPER_ADMIN lands on Mine.
  // Query string wins if present and valid.
  const initial = useMemo<Tab>(() => {
    const q = searchParams.get('tab');
    if (q === 'pending' && canApprove) return 'pending';
    if (q === 'mine' && canSeeMine)    return 'mine';
    return canApprove ? 'pending' : 'mine';
  }, [searchParams, canApprove, canSeeMine]);

  const [tab, setTab] = useState<Tab>(initial);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-10 space-y-6">
      <h1 className="text-2xl font-bold text-[#1e3a5f]">{t('staff.approvals.title')}</h1>

      <div className="border-b border-gray-200 -mx-1 overflow-x-auto">
        <div className="flex gap-1 px-1 min-w-max">
          {canApprove && (
            <TabButton
              active={tab === 'pending'}
              onClick={() => setTab('pending')}
              label={t('staff.approvals.tabs.pending')}
            />
          )}
          {canSeeMine && (
            <TabButton
              active={tab === 'mine'}
              onClick={() => setTab('mine')}
              label={t('staff.approvals.tabs.mine')}
            />
          )}
        </div>
      </div>

      <div>
        {tab === 'pending' && canApprove && <PendingApprovalsList />}
        {tab === 'mine'    && canSeeMine  && <MyRequestsList />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active:  boolean;
  onClick: () => void;
  label:   string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors min-h-[48px]',
        active
          ? 'border-[#F3CE49] text-[#1e3a5f]'
          : 'border-transparent text-gray-500 hover:text-[#1e3a5f]',
      ].join(' ')}
    >
      {label}
    </button>
  );
}
