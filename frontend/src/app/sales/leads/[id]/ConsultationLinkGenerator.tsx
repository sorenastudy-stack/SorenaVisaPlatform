'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// Consultation payment-link generator — relocated verbatim from the retired
// legacy /admin dashboard to the Sales lead-detail page (its intended home;
// the backend comment even anticipates "lead-detail flows").
//
// FAITHFUL MOVE — the money path is unchanged: it POSTs { leadId,
// consultationType } to /payments/consultation-link and the SERVER derives the
// amount from the type. The client never sends an amount. The NZD figures in
// the button labels are display-only (they mirror the server's amounts); they
// are not sent to the endpoint. Only the auth transport changed: it now uses
// the platform session (api client) instead of the legacy localStorage token.

interface LinkResponse { url?: string }

// route (lead.recommendedRoute) → the payment link(s) offered, matching the
// original ActionButtons mapping exactly.
export function ConsultationLinkGenerator({
  leadId,
  recommendedRoute,
}: {
  leadId: string;
  recommendedRoute: string | null;
}) {
  const [loadingType, setLoadingType] = useState<string | null>(null);

  const generateLink = async (consultationType: string) => {
    if (consultationType === 'FREE_SESSION') {
      toast.success('Free session booked — contact lead to confirm time');
      return;
    }
    setLoadingType(consultationType);
    try {
      // Body is exactly what the legacy tool sent — leadId + type only.
      const data = await api.post<LinkResponse>('/payments/consultation-link', {
        leadId,
        consultationType,
      });
      if (data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      } else {
        toast.success('Payment link generated — no URL returned');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to generate payment link');
    } finally {
      setLoadingType(null);
    }
  };

  const Btn = ({ label, variant, consultationType }: {
    label: string;
    variant: 'green' | 'red' | 'grey';
    consultationType: string;
  }) => {
    const isLoading = loadingType === consultationType;
    const isDisabled = isLoading || (loadingType !== null && loadingType !== consultationType);
    const base = 'w-full rounded-xl px-4 py-3 text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
    const tone =
      variant === 'green' ? 'bg-[#0d7a6e] text-white hover:bg-[#0b6a60]'
        : variant === 'red' ? 'bg-[#991b1b] text-white hover:bg-[#7f1717]'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200';
    return (
      <button onClick={() => generateLink(consultationType)} disabled={isDisabled} className={`${base} ${tone}`}>
        {isLoading ? 'Generating link…' : label}
      </button>
    );
  };

  // Route-gated, mirroring the original tool. Payment-relevant routes only.
  let body: React.ReactNode;
  switch (recommendedRoute) {
    case 'ROADMAP':
      body = <Btn variant="green" label="Generate Gap-Closing Session Link (30 NZD)" consultationType="GAP_CLOSING" />;
      break;
    case 'ADMISSION_CONSULTATION':
      body = <Btn variant="green" label="Generate Admission Consultation Link (50 NZD)" consultationType="ADMISSION_CONSULTATION" />;
      break;
    case 'LIA_CONSULTATION':
      body = (
        <div className="space-y-2">
          <Btn variant="red" label="Generate LIA Consultation Link (150 NZD)" consultationType="LIA_CONSULTATION" />
          <p className="text-center text-xs font-bold text-[#991b1b]">⚠️ Do not proceed without LIA clearance</p>
        </div>
      );
      break;
    case 'EXECUTION_QUEUE':
      body = (
        <div className="space-y-2">
          <Btn variant="green" label="Book Free 15-Min Session" consultationType="FREE_SESSION" />
          <Btn variant="grey" label="Generate Account Opening Link (200 NZD)" consultationType="ACCOUNT_OPENING" />
        </div>
      );
      break;
    default:
      body = (
        <p className="text-sm text-[#4A4A4A]/60">
          No payment link applies to this lead&apos;s recommended route
          {recommendedRoute ? ` (${recommendedRoute})` : ''}.
        </p>
      );
  }

  return <div>{body}</div>;
}
