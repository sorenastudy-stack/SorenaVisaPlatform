import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowRight, FileText, Sparkles, Users, Wallet, ListChecks, Clock, MessageSquare, CheckCircle2, Award, Mail, GraduationCap, ClipboardList, FolderOpen } from 'lucide-react';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { getSession } from '@/lib/auth';
import { UpcomingBookings } from '@/components/portal/UpcomingBookings';
import { ReloginBanner } from '@/components/portal/ReloginBanner';
import { AssessmentPdfButton } from '@/components/portal/AssessmentPdfButton';
import { formatDate as fmtDate } from '@/lib/date';

// Client portal step 3 — the client's case overview.
//
// Server component: fetches GET /portal/me/case with the cookie-bound
// session. The backend returns the whitelisted shape; we map stage
// to a friendly human message and render filled slots only.

interface AssignedPerson { name: string }
interface NextStep { kind: string; label: string; detail: string | null; invoiceId?: string | null }
interface TimelineEvent { date: string; kind: string; label: string }

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
  nextSteps:            NextStep[];
  timeline:             TimelineEvent[];
}

interface AssessmentResult {
  submissionId: string;
  bandName:     string;
  bandRange:    string;
  submittedAt:  string;
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

  // Contact channel: the case-message thread is STUDENT-only (/student/case/
  // messages). Show the "message your team" CTA to students; a LEAD sees a
  // calm "your team will be in touch" note instead of a link that 403s.
  const session = await getSession();
  const canMessage = session?.role === 'STUDENT';

  // Promoted-but-stale detection: the DB says STAGE_2 (client + LIA have
  // signed → the user was promoted to STUDENT), but this browser's session
  // cookie still holds the old LEAD role, so /student/* would bounce them
  // until they re-authenticate. Show a gentle "sign in again" prompt.
  let portalStage: 'STAGE_1' | 'STAGE_2' = 'STAGE_1';
  try {
    const s = await apiServer.get<{ portalStage: 'STAGE_1' | 'STAGE_2' }>('/portal/me/stage');
    portalStage = s.portalStage;
  } catch {
    /* default STAGE_1 → no banner */
  }
  const promotedButStale = portalStage === 'STAGE_2' && session?.role !== 'STUDENT';

  // Stage-1 assessment card — the client's own latest readiness result. The
  // endpoint 404s when they've never submitted; treat that as "no card".
  let assessment: AssessmentResult | null = null;
  try {
    assessment = await apiServer.get<AssessmentResult>('/scorecard/me/latest');
  } catch {
    /* no submission (404) or transient error → no assessment card */
  }

  // Stage-1 "contract ready to sign" prompt — reuse the existing contract
  // signal from getMyCase.nextSteps (emitted while the engagement letter is
  // DRAFT/SENT/VIEWED). No in-portal sign link exists — the client signs via
  // the DocuSign email.
  const contractReadyToSign = caseData.nextSteps.some((s) => s.kind === 'CONTRACT');

  return (
    <div className="space-y-6">
      {promotedButStale && <ReloginBanner />}

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

      {/* ── Contract ready to sign (check email) ─────────────────────── */}
      {contractReadyToSign && (
        <section className="rounded-2xl border border-[#F3CE49]/50 bg-[#faf8f3] p-5 md:p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#F3CE49]/20">
              <Mail size={20} className="text-[#8a6d10]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-[#1e3a5f]">{t('portal.contractReady.title')}</h2>
              <p className="mt-1 text-sm leading-relaxed text-gray-600">{t('portal.contractReady.body')}</p>
            </div>
          </div>
        </section>
      )}

      {/* ── What to do next ──────────────────────────────────────────── */}
      <section className="rounded-2xl bg-white border border-gray-200 p-5 md:p-6">
        <div className="flex items-center gap-2 mb-4">
          <ListChecks size={16} className="text-[#b8941f]" />
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">What to do next</h2>
        </div>
        {caseData.nextSteps.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <CheckCircle2 size={18} className="text-sorena-jade" />
            You’re all caught up — nothing needed from you right now.
          </div>
        ) : (
          <ul className="space-y-2">
            {caseData.nextSteps.map((s, i) => (
              <li key={i} className="flex items-start justify-between gap-3 rounded-xl border border-[#F3CE49]/40 bg-[#faf8f3] px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#1e3a5f]">{s.label}</p>
                  {s.detail && <p className="text-xs text-gray-500 mt-0.5">{s.detail}</p>}
                </div>
                {s.kind === 'DOCUMENT' && (
                  <Link href="/portal/case/documents" className="shrink-0 text-xs font-semibold text-[#1e3a5f] underline underline-offset-4 hover:text-[#b8941f]">
                    Open
                  </Link>
                )}
                {/* Signing is email-only (see the banner above). This step points
                    the client at their email — NOT the payment-gated documents
                    page, which was a dead-end that funnelled them into the gate. */}
                {s.kind === 'CONTRACT' && (
                  <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-[#8a6d10]">
                    <Mail size={13} /> Check your email
                  </span>
                )}
                {s.kind === 'INVOICE' && s.invoiceId && (
                  <Link
                    href={`/portal/case/pay?invoiceId=${s.invoiceId}`}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#1e3a5f] px-5 py-2.5 text-[#faf8f3] text-sm font-semibold min-h-[44px] hover:bg-[#162d4a] transition-colors"
                  >
                    Pay now
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Stage 2: active case entry points (contract signed) ──────── */}
      {portalStage === 'STAGE_2' && (
        <section className="rounded-2xl bg-white border border-gray-200 p-5 md:p-6">
          <div className="flex items-center gap-2 mb-4">
            <GraduationCap size={16} className="text-[#b8941f]" />
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">{t('portal.stage2.heading')}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Stage2Card href="/student/admission" icon={<GraduationCap size={18} className="text-[#1e3a5f]" />} title={t('portal.stage2.study')} body={t('portal.stage2.studyBody')} />
            <Stage2Card href="/student/documents"  icon={<ClipboardList size={18} className="text-[#1e3a5f]" />} title={t('portal.stage2.visa')} body={t('portal.stage2.visaBody')} />
            <Stage2Card href="/student/admission" icon={<FolderOpen size={18} className="text-[#1e3a5f]" />} title={t('portal.stage2.documents')} body={t('portal.stage2.documentsBody')} />
            <Stage2Card href="/student/tickets"    icon={<MessageSquare size={18} className="text-[#1e3a5f]" />} title={t('portal.stage2.tickets')} body={t('portal.stage2.ticketsBody')} />
          </div>
        </section>
      )}

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

      {/* ── Readiness assessment (if the client has a result) ────────── */}
      {assessment && (
        <section className="rounded-2xl bg-white border border-gray-200 p-5 md:p-6">
          <div className="flex items-center gap-2 mb-3">
            <Award size={16} className="text-[#b8941f]" />
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">{t('portal.assessment.title')}</h2>
          </div>
          <p className="text-lg font-bold text-[#1e3a5f]">{assessment.bandName}</p>
          <p className="text-sm text-gray-500">{assessment.bandRange}</p>
          <p className="mt-1 text-xs text-gray-400">{t('portal.assessment.completed')} {formatDate(assessment.submittedAt)}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href="/portal/report"
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1e3a5f] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#162d4a] transition-colors"
            >
              View full report <ArrowRight size={14} />
            </Link>
            <AssessmentPdfButton submissionId={assessment.submissionId} />
          </div>
        </section>
      )}

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
          {/* How to reach them */}
          {canMessage ? (
            <Link
              href="/student/case/messages"
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#1e3a5f] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#162d4a] transition-colors"
            >
              <MessageSquare size={16} /> Message your case team
            </Link>
          ) : (
            <p className="mt-4 text-xs text-gray-500">Your team will reach out here as your application progresses.</p>
          )}
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

      {/* ── Case timeline ────────────────────────────────────────────── */}
      {caseData.timeline.length > 0 && (
        <section className="rounded-2xl bg-white border border-gray-200 p-5 md:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={16} className="text-[#b8941f]" />
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Your case timeline</h2>
          </div>
          <ol className="relative border-l border-gray-200 pl-5 space-y-4">
            {caseData.timeline.map((e, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[23px] top-1.5 w-2.5 h-2.5 rounded-full bg-[#F3CE49] ring-2 ring-white" aria-hidden />
                <p className="text-sm font-medium text-[#1e3a5f]">{e.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{formatDate(e.date)}</p>
              </li>
            ))}
          </ol>
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

// Stage-2 entry-point card — a plain link to an existing /student/* page. No
// sensitive data rendered here; the target pages are own-data + STUDENT gated.
function Stage2Card({ href, icon, title, body }: { href: string; icon: React.ReactNode; title: string; body: string }) {
  return (
    <Link
      href={href}
      className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-all hover:border-[#1e3a5f]/40 hover:shadow-sm"
    >
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#1e3a5f]/10">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-[#1e3a5f]">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{body}</p>
      </div>
      <ArrowRight size={16} className="mt-1 flex-shrink-0 text-gray-300" />
    </Link>
  );
}
