'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Compass, Target, Globe, ShieldCheck, Banknote, Clock,
} from 'lucide-react';
import { LANDING_STRINGS } from '@/lib/scorecard/labels';

// PR-SCORECARD-2 — Public scorecard landing page (Fix 8 overhaul).
//
// Path: /scorecard/landing
// Auth: NONE — this page is the public entry to the funnel.
//
// Fix 8 changes:
//   * Real Sorena Visa branding (white logotype on navy hero, dark
//     logotype in the footer band)
//   * Headline broadened from "...New Zealand" to "Studying Abroad"
//     since high-band users now see the Malaysia callout too
//   * Three new sections: "What you'll discover", "Why Sorena Visa",
//     "How it works" — gives the page real marketing weight
//   * Footer band with logo + copyright + placeholder links
//
// Fix 9 (English-only): no locale toggle on this page. Strings come
// from the labels.ts plain-string export.

// Attribution capture: reads ?ch=, ?agent=, ?campaign= and persists
// them to sessionStorage so they survive the navigation through
// signup → form → results. The sv_attribution cookie set by the
// /s/:shortCode short-link redirector is also forwarded to the form
// at submit time (the form reads it from document.cookie).

export default function ScorecardLandingPage() {
  const router = useRouter();

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
        // sessionStorage disabled — attribution still flows via the
        // sv_attribution cookie set by the short-link redirector.
      }
    }
  }, []);

  return (
    <div className="min-h-screen bg-white">
      {/* ─── HERO ─────────────────────────────────────────────────── */}
      <section
        className="relative w-full"
        style={{
          background: 'linear-gradient(135deg, #1E3A5F 0%, #15263F 100%)',
        }}
      >
        <div className="max-w-5xl mx-auto px-6 py-16 sm:py-24 text-center">
          {/* Logo */}
          <Link
            href="/scorecard/landing"
            aria-label="Sorena Visa"
            className="inline-block mb-8"
          >
            <img
              src="/brand/SorenaVisaLogoTypeWhite.jpg"
              alt="Sorena Visa"
              className="h-12 sm:h-16 md:h-20 w-auto mx-auto"
              style={{ maxWidth: 280 }}
            />
          </Link>

          {/* Gold divider */}
          <div className="w-10 h-0.5 bg-[#E8B923] mx-auto mb-8" />

          <div className="text-[#E8B923] text-xs font-bold uppercase tracking-[0.18em] mb-4">
            {LANDING_STRINGS.heroTagline}
          </div>

          <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-white leading-tight max-w-3xl mx-auto mb-5">
            {LANDING_STRINGS.heroTitle}
          </h1>

          <p className="text-base sm:text-lg text-white/80 leading-relaxed max-w-2xl mx-auto mb-10">
            {LANDING_STRINGS.heroSubtitle}
          </p>

          <button
            onClick={() => router.push('/scorecard')}
            style={{ minHeight: 64 }}
            className="inline-flex items-center gap-2 px-10 py-4 bg-[#E8B923] text-[#1E3A5F] font-bold text-base sm:text-lg rounded-2xl hover:bg-[#d4a91f] transition-colors shadow-2xl shadow-black/30"
          >
            {LANDING_STRINGS.heroCta}
          </button>

          <div className="mt-6 text-sm text-white/70">
            {LANDING_STRINGS.signinHint}{' '}
            <Link href="/login?returnTo=/scorecard" className="font-semibold text-white hover:text-[#E8B923] underline-offset-4 hover:underline">
              {LANDING_STRINGS.signinLink}
            </Link>
          </div>

          <div className="mt-8 inline-flex items-center gap-2 text-xs text-white/60">
            <ShieldCheck size={14} className="text-[#E8B923]" />
            {LANDING_STRINGS.trustAuthorizedAgent}
          </div>
        </div>
      </section>

      {/* ─── WHAT YOU'LL DISCOVER ─────────────────────────────────── */}
      <section className="bg-[#FAF8F3] py-16 sm:py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1E3A5F] text-center mb-12">
            What you&apos;ll discover
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <FeatureCard
              icon={<Compass size={28} className="text-[#E8B923]" />}
              title="Your readiness score"
              body="Out of 100, with a personalised band classification."
            />
            <FeatureCard
              icon={<Target size={28} className="text-[#E8B923]" />}
              title="Your next best step"
              body="Concrete action: nurture pathway, gap-closing session, or full account opening."
            />
            <FeatureCard
              icon={<Globe size={28} className="text-[#E8B923]" />}
              title="Country eligibility"
              body="Find out if you qualify for New Zealand, Malaysia, or both."
            />
          </div>
        </div>
      </section>

      {/* ─── WHY SORENA VISA ──────────────────────────────────────── */}
      <section className="bg-white py-16 sm:py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1E3A5F] text-center mb-12">
            Why Sorena Visa
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <FeatureCard
              icon={<ShieldCheck size={28} className="text-[#E8B923]" />}
              title="Authorised agent"
              body="Officially partnered with NZ and Malaysian universities."
            />
            <FeatureCard
              icon={<Banknote size={28} className="text-[#E8B923]" />}
              title="Zero service fees on enrolment"
              body="Universities pay our commission — you only cover government and platform fees."
            />
            <FeatureCard
              icon={<Clock size={28} className="text-[#E8B923]" />}
              title="Fast turnaround"
              body="Receive your assessment results immediately upon submission."
            />
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS ─────────────────────────────────────────── */}
      <section className="bg-[#FAF8F3] py-16 sm:py-20 px-6">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1E3A5F] text-center mb-12">
            How it works
          </h2>
          <ol className="space-y-6">
            <Step n={1} title="Sign up" body="Takes 30 seconds." />
            <Step n={2} title="Answer 53 questions about your profile" body="Takes about 10 minutes. Your progress is autosaved — you can pause and return." />
            <Step n={3} title="Receive your score, band, and personalised next step" body="Generated immediately upon submission. No waiting." />
            <Step n={4} title="Book a free consultation (if you qualify) or follow your nurture pathway" body="Bands 4-6 get a free 15-minute consultation. Band 3 gets a paid Gap-Closing session. Bands 1-2 get a learning pathway." />
          </ol>

          <div className="text-center mt-12">
            <button
              onClick={() => router.push('/scorecard')}
              style={{ minHeight: 56 }}
              className="inline-flex items-center gap-2 px-8 py-3.5 bg-[#1E3A5F] text-white font-bold text-base rounded-xl hover:bg-[#162d49] transition-colors shadow-lg"
            >
              {LANDING_STRINGS.heroCta}
            </button>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ────────────────────────────────────────────── */}
      <footer className="bg-[#1E3A5F] text-white py-10 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6 text-center sm:text-left">
          <div className="flex items-center gap-3">
            <img
              src="/brand/SorenaVisaLogoTypeWhite.jpg"
              alt="Sorena Visa"
              className="h-8 w-auto"
              style={{ maxWidth: 160 }}
            />
          </div>
          <div className="text-xs text-white/70">
            © 2026 Sorena Visa · Education &amp; Immigration · New Zealand
          </div>
          <div className="flex items-center gap-4 text-xs text-white/70">
            <a href="#" className="hover:text-[#E8B923]">Terms</a>
            <a href="#" className="hover:text-[#E8B923]">Privacy</a>
            <a href="#" className="hover:text-[#E8B923]">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon, title, body,
}: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-md border border-gray-100">
      <div className="mb-4">{icon}</div>
      <div className="text-[#1E3A5F] font-bold text-base mb-2">{title}</div>
      <div className="text-sm text-[#4A4A4A]/80 leading-relaxed">{body}</div>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex items-start gap-4">
      <span className="flex items-center justify-center w-10 h-10 rounded-full bg-[#E8B923] text-[#1E3A5F] font-extrabold text-lg flex-shrink-0">
        {n}
      </span>
      <div className="pt-1">
        <div className="text-[#1E3A5F] font-bold text-base mb-1">{title}</div>
        <div className="text-sm text-[#4A4A4A]/80 leading-relaxed">{body}</div>
      </div>
    </li>
  );
}
