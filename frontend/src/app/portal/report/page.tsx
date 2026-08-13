import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Sparkles } from 'lucide-react';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { ScorecardResultClient } from '@/components/scorecard/ScorecardResultClient';
import type { ScorecardResultPayload } from '@/app/scorecard/result/page';

// Client portal — full readiness report.
//
// Reuses the tested <ScorecardResultClient> renderer WITHOUT the standalone
// ScorecardHeader / AboutSorenaBrief, so the report sits inside the portal
// shell. Data comes from the same session-gated endpoint the public result
// page uses.
//
// PR-PORTAL-EMPTY-STATES — a client with no assessment used to be redirected
// to /portal/case. They clicked "My Assessment" and silently arrived somewhere
// else, with nothing explaining why and no way to discover what the section
// was for. A section with no data now says so and offers the next step, which
// is the standing rule for empty states across the portal: never a silent
// redirect, never a hidden nav item.
export default async function PortalReportPage() {
  const t = await getTranslations('portal.report');
  let data: ScorecardResultPayload | null = null;
  try {
    data = await apiServer.get<ScorecardResultPayload>('/scorecard/me/latest');
  } catch (e) {
    // 401 is a genuine session problem and still belongs at the login screen.
    if (e instanceof ApiServerError && e.statusCode === 401) redirect('/client/login');
    // 404 means "no assessment yet" — a state, not an error.
    if (!(e instanceof ApiServerError) || e.statusCode !== 404) throw e;
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 md:px-8 md:py-16">
        <div className="rounded-2xl border border-dashed border-[#1e3a5f]/15 bg-[#faf8f3] p-10 text-center">
          <Sparkles size={30} className="mx-auto mb-4 text-[#c9a961]" />
          <h1 className="text-xl font-bold text-[#1e3a5f]">{t('emptyTitle')}</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[#4A4A4A]/70">
            {t('emptyBody')}
          </p>
          <Link
            href="/scorecard"
            className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#1e3a5f] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1e3a5f]/90"
          >
            {t('emptyCta')}
          </Link>
        </div>
      </div>
    );
  }

  return <ScorecardResultClient data={data!} />;
}
