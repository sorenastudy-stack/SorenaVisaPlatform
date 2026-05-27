'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CreditCard, ExternalLink, RefreshCcw, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-SCORECARD-4 — Staff-side Wix payments browser.
//
// Lists every payment / booking the Wix Automation has posted to
// the webhook. Filters by type, status, and customer email. Click
// through to the detail page for the raw Wix payload.
//
// Role gate (OWNER / SUPER_ADMIN / ADMIN / FINANCE) is enforced by
// the backend; the UI also hides behind the staff layout's session
// check.

interface WixPaymentOut {
  id: string;
  wixPaymentId: string;
  wixBookingId: string | null;
  paymentType: 'FREE_15MIN' | 'GAP_CLOSING' | 'LIA_CONSULTATION' | 'OTHER';
  amount: string;
  currency: string;
  status: 'RECEIVED' | 'REFUNDED' | 'DISPUTED';
  customerEmail: string;
  customerName: string | null;
  customerPhone: string | null;
  bookingStart: string | null;
  bookingEnd: string | null;
  bookingLocation: string | null;
  matchedLeadId: string | null;
  matchedUserId: string | null;
  matchedLeadName: string | null;
  matchedLeadEmail: string | null;
  matchedUserName: string | null;
  receivedAt: string;
}

interface ListResponse {
  data: WixPaymentOut[];
  total: number;
  limit: number;
  offset: number;
}

const TYPE_LABEL: Record<WixPaymentOut['paymentType'], string> = {
  FREE_15MIN:        'Free 15-min',
  GAP_CLOSING:       'Gap-Closing',
  LIA_CONSULTATION:  'LIA Consult',
  OTHER:             'Other',
};

const STATUS_COLOR: Record<WixPaymentOut['status'], string> = {
  RECEIVED:  'bg-emerald-100 text-emerald-800 border-emerald-200',
  REFUNDED:  'bg-amber-100 text-amber-800 border-amber-200',
  DISPUTED:  'bg-red-100 text-red-800 border-red-200',
};

export default function WixPaymentsPage() {
  const [rows, setRows] = useState<WixPaymentOut[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterEmail, setFilterEmail] = useState<string>('');
  const [filterSince, setFilterSince] = useState<string>('');

  const query = useMemo(() => {
    const qs = new URLSearchParams();
    if (filterType)   qs.set('paymentType', filterType);
    if (filterStatus) qs.set('status', filterStatus);
    if (filterEmail.trim().length > 0) qs.set('customerEmail', filterEmail.trim());
    if (filterSince)  qs.set('since', filterSince);
    qs.set('limit', '100');
    return qs.toString();
  }, [filterType, filterStatus, filterEmail, filterSince]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ListResponse>(`/staff/wix-payments?${query}`);
      setRows(res.data);
      setTotal(res.total);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
            <CreditCard size={22} className="text-[#E8B923]" />
            Wix payments
          </h1>
          <p className="text-sm text-[#4A4A4A]/70 mt-1">
            Confirmed payments and bookings received from Wix Automations.
            {' '}<Link href="/staff/platform-settings/wix-setup" className="text-[#1E3A5F] underline">Setup guide</Link>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#1E3A5F] text-[#1E3A5F] text-sm font-medium hover:bg-[#1E3A5F]/5"
        >
          <RefreshCcw size={13} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#4A4A4A]/70 mb-1">
                Type
              </label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
              >
                <option value="">All types</option>
                <option value="FREE_15MIN">Free 15-min</option>
                <option value="GAP_CLOSING">Gap-Closing (NZD 30)</option>
                <option value="LIA_CONSULTATION">LIA Consultation (NZD 150)</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#4A4A4A]/70 mb-1">
                Status
              </label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
              >
                <option value="">All statuses</option>
                <option value="RECEIVED">Received</option>
                <option value="REFUNDED">Refunded</option>
                <option value="DISPUTED">Disputed</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#4A4A4A]/70 mb-1">
                Customer email
              </label>
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#4A4A4A]/60" />
                <input
                  type="text"
                  value={filterEmail}
                  onChange={(e) => setFilterEmail(e.target.value)}
                  placeholder="contains…"
                  className="w-full rounded-lg border border-gray-300 pl-7 pr-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#4A4A4A]/70 mb-1">
                Since
              </label>
              <input
                type="date"
                value={filterSince}
                onChange={(e) => setFilterSince(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent>
          {loading && <div className="text-sm text-[#4A4A4A]/60 py-4">Loading…</div>}

          {!loading && rows.length === 0 && (
            <div className="py-8 text-center">
              <CreditCard size={32} className="mx-auto text-[#4A4A4A]/30 mb-2" />
              <p className="text-sm text-[#4A4A4A]/70">
                No Wix payments received yet. Once OWNER connects the Wix Automation,
                payments will appear here.
              </p>
              <Link
                href="/staff/platform-settings/wix-setup"
                className="inline-flex items-center gap-1 text-sm text-[#1E3A5F] hover:text-[#E8B923] font-medium mt-3"
              >
                Open the setup guide <ExternalLink size={11} />
              </Link>
            </div>
          )}

          {!loading && rows.length > 0 && (
            <>
              <div className="text-xs text-[#4A4A4A]/60 mb-2">
                Showing {rows.length} of {total} payment{total === 1 ? '' : 's'}.
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b border-gray-200 text-xs uppercase tracking-wide text-[#4A4A4A]/70">
                      <th className="py-2 pr-3 font-semibold">Received</th>
                      <th className="py-2 pr-3 font-semibold">Type</th>
                      <th className="py-2 pr-3 font-semibold">Amount</th>
                      <th className="py-2 pr-3 font-semibold">Customer</th>
                      <th className="py-2 pr-3 font-semibold">Matched lead</th>
                      <th className="py-2 pr-3 font-semibold">Status</th>
                      <th className="py-2 font-semibold w-0"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50">
                        <td className="py-2.5 pr-3 text-xs text-[#4A4A4A]">
                          {new Date(r.receivedAt).toLocaleString('en-NZ')}
                        </td>
                        <td className="py-2.5 pr-3 font-semibold text-[#1E3A5F]">
                          {TYPE_LABEL[r.paymentType]}
                        </td>
                        <td className="py-2.5 pr-3 font-mono text-[#1E3A5F]">
                          {r.amount} {r.currency}
                        </td>
                        <td className="py-2.5 pr-3 text-[#1E3A5F]">
                          {r.customerName ? <div>{r.customerName}</div> : null}
                          <div className="text-xs text-[#4A4A4A]/70">{r.customerEmail}</div>
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-[#4A4A4A]">
                          {r.matchedLeadId ? (
                            <Link
                              href={`/sales/leads/${r.matchedLeadId}`}
                              className="text-[#1E3A5F] hover:text-[#E8B923] underline font-medium"
                            >
                              {r.matchedLeadName ?? 'View'}
                            </Link>
                          ) : (
                            <span className="italic text-[#4A4A4A]/60">unmatched</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_COLOR[r.status]}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="py-2.5">
                          <Link
                            href={`/staff/wix-payments/${r.id}`}
                            className="text-sm font-medium text-[#1E3A5F] hover:text-[#E8B923]"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
