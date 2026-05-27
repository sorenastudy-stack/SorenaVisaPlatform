'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CreditCard, ArrowLeft, User, Calendar, MapPin, Phone, Mail, ExternalLink, Code2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-SCORECARD-4 — Wix payment detail page.
//
// Shows the customer block, the booking block (when applicable),
// any matched Sorena lead / user, and the raw Wix payload in a
// collapsible monospace pane.
//
// Viewing the detail writes a WIX_PAYMENT_VIEWED audit row server-
// side so the OWNER can see who looked at the raw payload.

interface WixPaymentDetail {
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
  rawPayload: unknown;
}

const TYPE_LABEL: Record<WixPaymentDetail['paymentType'], string> = {
  FREE_15MIN:        'Free 15-minute consultation',
  GAP_CLOSING:       'Gap-Closing Roadmap Session',
  LIA_CONSULTATION:  'LIA Consultation',
  OTHER:             'Other',
};

const STATUS_COLOR: Record<WixPaymentDetail['status'], string> = {
  RECEIVED:  'bg-emerald-100 text-emerald-800 border-emerald-200',
  REFUNDED:  'bg-amber-100 text-amber-800 border-amber-200',
  DISPUTED:  'bg-red-100 text-red-800 border-red-200',
};

export default function WixPaymentDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [row, setRow] = useState<WixPaymentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<WixPaymentDetail>(`/staff/wix-payments/${id}`)
      .then((data) => {
        if (cancelled) return;
        setRow(data);
        setLoading(false);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.message ?? 'Failed to load payment');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return <div className="text-sm text-[#4A4A4A]/60 py-4">Loading…</div>;
  }

  if (error || !row) {
    return (
      <div>
        <Link
          href="/staff/wix-payments"
          className="inline-flex items-center gap-1 text-sm text-[#1E3A5F] hover:text-[#E8B923] font-medium mb-4"
        >
          <ArrowLeft size={14} /> Back to payments
        </Link>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error ?? 'Payment not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <Link
        href="/staff/wix-payments"
        className="inline-flex items-center gap-1 text-sm text-[#1E3A5F] hover:text-[#E8B923] font-medium mb-4"
      >
        <ArrowLeft size={14} /> Back to payments
      </Link>

      {/* Header */}
      <Card className="mb-4">
        <CardContent>
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl font-bold text-[#1E3A5F] flex items-center gap-2 mb-1">
                <CreditCard size={20} className="text-[#E8B923]" />
                {TYPE_LABEL[row.paymentType]}
              </h1>
              <p className="text-xs text-[#4A4A4A]/60 font-mono">{row.wixPaymentId}</p>
            </div>
            <div className="text-right">
              <div className="font-mono text-xl font-bold text-[#1E3A5F]">
                {row.amount} {row.currency}
              </div>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border mt-1 ${STATUS_COLOR[row.status]}`}>
                {row.status}
              </span>
            </div>
          </div>
          <p className="text-xs text-[#4A4A4A]/60 mt-3">
            Received {new Date(row.receivedAt).toLocaleString('en-NZ')}.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Customer */}
        <Card>
          <CardContent>
            <h2 className="text-base font-bold text-[#1E3A5F] flex items-center gap-2 mb-3">
              <User size={16} className="text-[#E8B923]" /> Customer
            </h2>
            <dl className="text-sm space-y-2">
              <DRow icon={<User size={13} />} label="Name" value={row.customerName} />
              <DRow icon={<Mail size={13} />} label="Email" value={row.customerEmail} mono />
              <DRow icon={<Phone size={13} />} label="Phone" value={row.customerPhone} mono />
            </dl>
          </CardContent>
        </Card>

        {/* Booking (when applicable) */}
        <Card>
          <CardContent>
            <h2 className="text-base font-bold text-[#1E3A5F] flex items-center gap-2 mb-3">
              <Calendar size={16} className="text-[#E8B923]" /> Booking
            </h2>
            {row.bookingStart || row.bookingEnd || row.wixBookingId || row.bookingLocation ? (
              <dl className="text-sm space-y-2">
                <DRow icon={<Calendar size={13} />} label="Start"
                  value={row.bookingStart ? new Date(row.bookingStart).toLocaleString('en-NZ') : null} />
                <DRow icon={<Calendar size={13} />} label="End"
                  value={row.bookingEnd ? new Date(row.bookingEnd).toLocaleString('en-NZ') : null} />
                <DRow icon={<MapPin size={13} />} label="Location" value={row.bookingLocation} />
                <DRow icon={<ExternalLink size={13} />} label="Wix booking" value={row.wixBookingId} mono />
              </dl>
            ) : (
              <p className="text-sm text-[#4A4A4A]/60 italic">No booking attached.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Matched lead / user */}
      <Card className="mb-4">
        <CardContent>
          <h2 className="text-base font-bold text-[#1E3A5F] mb-3">Sorena match</h2>
          {row.matchedLeadId || row.matchedUserId ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              {row.matchedLeadId && (
                <div className="rounded-lg border border-gray-200 p-3">
                  <div className="text-xs uppercase tracking-wide text-[#4A4A4A]/70 mb-1">Lead</div>
                  <Link
                    href={`/sales/leads/${row.matchedLeadId}`}
                    className="text-[#1E3A5F] hover:text-[#E8B923] underline font-medium"
                  >
                    {row.matchedLeadName ?? 'View lead'}
                  </Link>
                  {row.matchedLeadEmail && (
                    <div className="text-xs text-[#4A4A4A]/60 mt-0.5">{row.matchedLeadEmail}</div>
                  )}
                </div>
              )}
              {row.matchedUserId && (
                <div className="rounded-lg border border-gray-200 p-3">
                  <div className="text-xs uppercase tracking-wide text-[#4A4A4A]/70 mb-1">User</div>
                  <div className="font-medium text-[#1E3A5F]">{row.matchedUserName ?? 'Linked user'}</div>
                  <div className="text-xs text-[#4A4A4A]/60 font-mono mt-0.5">{row.matchedUserId}</div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-[#4A4A4A]/60 italic">
              No Sorena lead or user matched this payment by email.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Raw payload */}
      <Card>
        <CardContent>
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="text-sm font-bold text-[#1E3A5F] hover:text-[#E8B923] inline-flex items-center gap-1.5"
          >
            <Code2 size={14} />
            {showRaw ? '▾' : '▸'} Raw Wix payload
          </button>
          {showRaw && (
            <pre className="mt-3 bg-gray-50 rounded p-3 text-xs font-mono text-[#1E3A5F] overflow-x-auto leading-relaxed border border-gray-200">
              {JSON.stringify(row.rawPayload, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DRow({
  icon, label, value, mono = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[#4A4A4A]/60 mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-wide text-[#4A4A4A]/60">{label}</div>
        <div className={`text-sm ${mono ? 'font-mono' : ''} text-[#1E3A5F] break-words`}>
          {value && value.length > 0 ? value : <span className="italic text-[#4A4A4A]/50">—</span>}
        </div>
      </div>
    </div>
  );
}
