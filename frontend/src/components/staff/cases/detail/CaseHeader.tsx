'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { CaseStatusPill } from '../CaseStatusPill';
import type { CaseDetail } from './types';

// PR-CONSULT-2 — Case detail header.
//
// Back button + student name + status pill. The back button uses
// router.back() so the user returns to whichever filter / page they
// came from on the cases list.
export function CaseHeader({ data }: { data: CaseDetail }) {
  const router = useRouter();
  const fullName = `${data.student.firstName} ${data.student.lastName}`.trim();
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => router.back()}
        className="self-start flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors"
      >
        <ArrowLeft size={16} />
        Back
      </button>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-[#1e3a5f]">
          {fullName || data.student.email || data.id}
        </h1>
        <CaseStatusPill status={data.status} />
      </div>
    </div>
  );
}
