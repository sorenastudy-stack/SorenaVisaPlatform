'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CreditCard, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';

// PR-SCORECARD-4 — Wix payments rendered on a lead's detail page.
//
// Fetches /staff/wix-payments/lead/:leadId. Only OWNER / SUPER_ADMIN /
// ADMIN / FINANCE are allowed by the backend — for any other role
// the fetch returns 403 and we render nothing.

interface WixPaymentRow {
  id: string;
  paymentType: 'FREE_15MIN' | 'GAP_CLOSING' | 'LIA_CONSULTATION' | 'OTHER';
  amount: string;
  currency: string;
  status: 'RECEIVED' | 'REFUNDED' | 'DISPUTED';
  receivedAt: string;
}

const TYPE_LABEL: Record<WixPaymentRow['paymentType'], string> = {
  FREE_15MIN:        'Free 15-min',
  GAP_CLOSING:       'Gap-Closing',
  LIA_CONSULTATION:  'LIA Consultation',
  OTHER:             'Other',
};

const STATUS_COLOR: Record<WixPaymentRow['status'], string> = {
  RECEIVED:  'text-emerald-700',
  REFUNDED:  'text-amber-700',
  DISPUTED:  'text-red-700',
};

export function LeadWixPayments({ leadId }: { leadId: string }) {
  const [rows, setRows] = useState<WixPaymentRow[] | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<WixPaymentRow[]>(`/staff/wix-payments/lead/${leadId}`)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (cancelled) return;
        // 403 → role lacks access. Just hide the section.
        if (e?.statusCode === 403) setForbidden(true);
        else setRows([]);
      });
    return () => { cancelled = true; };
  }, [leadId]);

  if (forbidden) return null;
  if (rows === null) {
    return (
      <div className="bg-sorena-cream rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-lg font-bold text-[#1E3A5F] flex items-center gap-2 mb-2">
          <CreditCard size={18} className="text-[#b8941f]" /> Wix payments
        </h3>
        <p className="text-sm text-[#4A4A4A]/60">Loading…</p>
      </div>
    );
  }

  return (
    <div className="bg-sorena-cream rounded-xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-[#1E3A5F] flex items-center gap-2">
          <CreditCard size={18} className="text-[#b8941f]" /> Wix payments
        </h3>
        {rows.length > 0 && (
          <Link
            href="/staff/wix-payments"
            className="text-xs text-[#1E3A5F] hover:text-[#b8941f] font-medium inline-flex items-center gap-1"
          >
            All payments <ExternalLink size={11} />
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-[#4A4A4A]/60">No Wix payments yet for this lead.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((r) => (
            <li key={r.id} className="py-2 flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-semibold text-[#1E3A5F]">{TYPE_LABEL[r.paymentType]}</span>
                <span className="font-mono text-[#1E3A5F]">
                  {r.amount} {r.currency}
                </span>
                <span className={`text-xs font-semibold uppercase tracking-wide ${STATUS_COLOR[r.status]}`}>
                  {r.status}
                </span>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-xs text-[#4A4A4A]/60">
                  {new Date(r.receivedAt).toLocaleString('en-NZ')}
                </span>
                <Link
                  href={`/staff/wix-payments/${r.id}`}
                  className="text-xs text-[#1E3A5F] hover:text-[#b8941f] font-medium"
                >
                  View
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
