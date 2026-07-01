import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowRight, FileText, Sparkles, Users, Wallet } from 'lucide-react';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { UpcomingBookings } from '@/components/portal/UpcomingBookings';
import { formatDate as fmtDate } from '@/lib/date';

// Client portal step 3 — the client's case overview.
//
// Server component: fetches GET /portal/me/case with the cookie-bound
// session. The backend returns the whitelisted shape; we map stage
// to a friendly human message and render filled slots only.

interface AssignedPerson { name: string }

interface MyCase {
  id:                   string;
  stage:                string;
  status:               string;
  createdAt:            string;
  updatedAt:            string;
  assignedLia:          AssignedPerson | null;
  assignedConsultant:   AssignedPerson | null;
  assignedSupport:      AssignedPerson | null;
  assignedFinance:      AssignedPerson | null;
  inzApplicationNumber: string | null;
  inzSubmittedAt:       string | null;
}

function formatDate(iso: string | null): string | null {
  // Day-first NZ style ("8 Jul 2026") via the shared helper.
  return iso ? fmtDate(iso) : null;
}

export default async function MyCasePage() {
  const t = await getTranslations();

  let caseData: MyCase | null = null;
  let notFound = false;
  let loadError = false;

  try {
    caseData = await apiServer.get<MyCase>('/portal/me/case');
  } catch (err) {
    if (err instanceof ApiServerError && err.statusCode === 404) {
      notFound = true;
    } else {
      loadError = true;
    }
  }

  // ─── No case yet — calm reassuring state ────────────────────────────
  // A client can have booked sessions before a case exists, so the
  // bookings section renders above the reassurance message.
  if (notFound) {
    return (
      <div className="space-y-6">
        <UpcomingBookings />
        <section className="rounded-2xl bg-white border border-gray-200 p-8 md:p-12 text-center">
          <div className="mx-auto mb-5 w-14 h-14 rounded-full bg-[#F3CE49]/15 flex items-center justify-center">
            <Sparkles size={24} className="text-[#b8941f]" />
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-[#1e3a5f] mb-2">
            {t('portal.case.noCase.title')}
          </h1>
          <p className="text-sm text-gray-600 leading-relaxed max-w-md mx-auto">
            {t('portal.case.noCase.body')}
          </p>
        </section>
      </div>
    );
  }

  // ─── Load failed (non-404) — calm error state ──────────────────────
  if (loadError || !caseData) {
    return (
      <div className="space-y-6">
        <UpcomingBookings />
        <section className="rounded-2xl bg-white border border-gray-200 p-8 text-center">
          <h1 className="text-lg font-bold text-[#1e3a5f] mb-2">
            {t('portal.case.loadError.title')}
          </h1>
          <p className="text-sm text-gray-600">
            {t('portal.case.loadError.body')}
          </p>
        </section>
      </div>
    );
  }

  const KNOWN_STAGES = new Set(['ADMISSION', 'VISA', 'INZ_SUBMITTED', 'COMPLETED', 'WITHDRAWN']);
  const stageMessage = KNOWN_STAGES.has(caseData.stage)
    ? t(`portal.case.stage.${caseData.stage}`)
    : t('portal.case.stage.fallback');

  // Build the team list with only filled slots, labelled by friendly role.
  const team: Array<{ label: string; name: string }> = [];
  if (caseData.assignedLia)        team.push({ label: t('portal.case.team.lia'),        name: caseData.assignedLia.name });
  if (caseData.assignedConsultant) team.push({ label: t('portal.case.team.consultant'), name: caseData.assignedConsultant.name });
  if (caseData.assignedSupport)    team.push({ label: t('portal.case.team.support'),    name: caseData.assignedSupport.name });
  if (caseData.assignedFinance)    team.push({ label: t('portal.case.team.finance'),    name: caseData.assignedFinance.name });

  const inzSubmittedDate = formatDate(caseData.inzSubmittedAt);

  return (
    <div className="space-y-6">
      {/* ── Status hero ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-3xl bg-[#1e3a5f] text-white px-6 py-8 md:px-10 md:py-12">
        <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-[#F3CE49]/15 blur-3xl" aria-hidden />
        <div className="relative">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#b8941f] font-semibold mb-3">
            {t('portal.case.heading')}
          </p>
          <h1 className="text-2xl md:text-3xl font-bold leading-tight max-w-2xl">
            {stageMessage}
          </h1>
        </div>
      </section>

      {/* ── Your upcoming sessions ───────────────────────────────────── */}
      <UpcomingBookings />

      {/* ── Wallet ───────────────────────────────────────────────────── */}
      <Link href="/portal/wallet" className="flex items-center justify-between rounded-2xl bg-white border border-gray-200 p-5 md:p-6 transition-all hover:border-sorena-navy/30 hover:shadow">
        <div className="flex items-center gap-2">
          <Wallet size={16} className="text-[#b8941f]" />
          <span className="text-sm font-bold uppercase tracking-wide text-gray-500">My wallet</span>
        </div>
        <ArrowRight size={16} className="text-gray-300" />
      </Link>

      {/* ── Your team ────────────────────────────────────────────────── */}
      {team.length > 0 && (
        <section className="rounded-2xl bg-white border border-gray-200 p-5 md:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Users size={16} className="text-[#b8941f]" />
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
              {t('portal.case.team.heading')}
            </h2>
          </div>
          <ul className="divide-y divide-gray-100">
            {team.map((p) => (
              <li key={p.label} className="py-3 flex items-center justify-between gap-3">
                <span className="text-xs uppercase tracking-wide text-gray-400 font-semibold">{p.label}</span>
                <span className="text-sm font-medium text-gray-900">{p.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── INZ reference (only if present) ──────────────────────────── */}
      {caseData.inzApplicationNumber && (
        <section className="rounded-2xl bg-[#faf8f3] border border-[#F3CE49]/30 p-5 md:p-6">
          <p className="text-xs uppercase tracking-wide text-[#1e3a5f]/60 font-semibold mb-1">
            {t('portal.case.inz.heading')}
          </p>
          <p className="text-lg font-bold text-[#1e3a5f]">
            {caseData.inzApplicationNumber}
          </p>
          {inzSubmittedDate && (
            <p className="text-xs text-gray-500 mt-1">
              {t('portal.case.inz.submittedOn', { date: inzSubmittedDate })}
            </p>
          )}
        </section>
      )}

      {/* ── Documents card (next-step CTA) ───────────────────────────── */}
      <Link
        href="/portal/case/documents"
        className="block rounded-2xl bg-white border border-gray-200 hover:border-[#1e3a5f]/40 hover:shadow-sm transition-all p-5 md:p-6"
      >
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-[#1e3a5f]/10 flex items-center justify-center">
            <FileText size={20} className="text-[#1e3a5f]" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-[#1e3a5f]">
              {t('portal.case.documents.cardHeading')}
            </h2>
            <p className="text-sm text-gray-600 mt-1 leading-relaxed">
              {t('portal.case.documents.cardBody')}
            </p>
          </div>
          <ArrowRight size={20} className="text-[#1e3a5f] mt-2 flex-shrink-0" />
        </div>
      </Link>
    </div>
  );
}
