'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Clock, Compass, Gift, ShieldCheck } from 'lucide-react';
import { useLocaleStore } from '@/lib/stores/localeStore';
import { LANDING_STRINGS, T } from '@/lib/scorecard/labels';

// PR-SCORECARD-2 — Public scorecard landing page.
//
// Path: /scorecard/landing
// Auth: NONE — this page is the public entry to the funnel.
//
// Attribution capture: reads ?ch=, ?agent=, ?campaign= and persists
// them to sessionStorage so they survive the navigation through
// signup → form → results. The sv_attribution cookie set by the
// /s/:shortCode short-link redirector is also forwarded to the form
// at submit time (the form reads it from document.cookie).

export default function ScorecardLandingPage() {
  const router = useRouter();
  const locale = useLocaleStore((s) => s.locale);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const ch = params.get('ch');
    const agent = params.get('agent');
    const campaign = params.get('campaign');
    if (ch || agent || campaign) {
      const attribution = {
        channel: ch ?? null,
        agentId: agent ?? null,
        campaignLabel: campaign ?? null,
      };
      try {
        sessionStorage.setItem('sv_scorecard_attribution', JSON.stringify(attribution));
      } catch {
        // localStorage / sessionStorage disabled — attribution still
        // lives in the cookie set by the short-link redirector.
      }
    }
  }, []);

  const isRtl = locale === 'fa';

  const valueCards = [
    {
      icon: <Clock size={28} className="text-[#E8B923]" />,
      title: T(LANDING_STRINGS.valueCard1Title, locale),
      body:  T(LANDING_STRINGS.valueCard1Body,  locale),
    },
    {
      icon: <Compass size={28} className="text-[#E8B923]" />,
      title: T(LANDING_STRINGS.valueCard2Title, locale),
      body:  T(LANDING_STRINGS.valueCard2Body,  locale),
    },
    {
      icon: <Gift size={28} className="text-[#E8B923]" />,
      title: T(LANDING_STRINGS.valueCard3Title, locale),
      body:  T(LANDING_STRINGS.valueCard3Body,  locale),
    },
  ];

  return (
    <div
      className="min-h-screen"
      style={{
        background: 'linear-gradient(135deg,#1E3A5F 0%,#0d4f6e 60%,#0a7a6e 100%)',
      }}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="max-w-5xl mx-auto px-6 py-12">
        {/* Brand mark */}
        <div className="flex items-center gap-3 mb-12">
          <img src="/brand/logo-mark-white.jpg" alt="Sorena" className="h-10 w-10 rounded" />
          <div>
            <div className="text-white font-extrabold text-lg leading-tight">Sorena Visa</div>
            <div className="text-[#E8B923] text-xs font-bold uppercase tracking-wider">
              Readiness Assessment
            </div>
          </div>
        </div>

        {/* Hero */}
        <div className="bg-white rounded-2xl p-8 md:p-12 shadow-xl mb-8">
          <div className="text-xs font-semibold uppercase tracking-wider text-[#E8B923] mb-3">
            {T(LANDING_STRINGS.heroTagline, locale)}
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-[#1E3A5F] leading-tight mb-4">
            {T(LANDING_STRINGS.heroTitle, locale)}
          </h1>
          <p className="text-base md:text-lg text-[#4A4A4A] leading-relaxed mb-8 max-w-2xl">
            {T(LANDING_STRINGS.heroSubtitle, locale)}
          </p>
          <button
            onClick={() => router.push('/scorecard')}
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-[#E8B923] text-[#1E3A5F] font-bold text-base rounded-xl hover:bg-[#d4a91f] transition-colors shadow-md"
          >
            {T(LANDING_STRINGS.heroCta, locale)}
          </button>

          {/* Sign-in hint */}
          <div className="mt-6 pt-6 border-t border-gray-100 text-sm text-[#4A4A4A]/70">
            {T(LANDING_STRINGS.signinHint, locale)}{' '}
            <Link href="/login?returnTo=/scorecard" className="font-semibold text-[#1E3A5F] hover:text-[#E8B923]">
              {T(LANDING_STRINGS.signinLink, locale)}
            </Link>
          </div>
        </div>

        {/* Value cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {valueCards.map((card, idx) => (
            <div
              key={idx}
              className="bg-white/95 backdrop-blur rounded-2xl p-6 shadow-md"
            >
              <div className="mb-3">{card.icon}</div>
              <div className="text-[#1E3A5F] font-bold text-base mb-1.5">{card.title}</div>
              <div className="text-sm text-[#4A4A4A]/80 leading-relaxed">{card.body}</div>
            </div>
          ))}
        </div>

        {/* Trust signal */}
        <div className="bg-white/10 backdrop-blur rounded-xl p-4 flex items-start gap-3 text-white">
          <ShieldCheck size={20} className="text-[#E8B923] flex-shrink-0 mt-0.5" />
          <p className="text-sm leading-relaxed">
            {T(LANDING_STRINGS.trustAuthorizedAgent, locale)}
          </p>
        </div>
      </div>
    </div>
  );
}
