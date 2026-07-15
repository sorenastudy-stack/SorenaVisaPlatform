import { redirect } from 'next/navigation';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { ScorecardResultClient } from '@/components/scorecard/ScorecardResultClient';
import type { ScorecardResultPayload } from '@/app/scorecard/result/page';

// Client portal — full readiness report.
//
// Reuses the tested <ScorecardResultClient> renderer WITHOUT the standalone
// ScorecardHeader / AboutSorenaBrief, so the report sits inside the portal
// shell. Data comes from the same session-gated endpoint the public result
// page uses. The /portal layout already enforces the LEAD/STUDENT session; the
// 401 guard here is belt-and-braces, and 404 (no submission yet) falls back to
// the case overview.

export default async function PortalReportPage() {
  let data: ScorecardResultPayload | null = null;
  try {
    data = await apiServer.get<ScorecardResultPayload>('/scorecard/me/latest');
  } catch (e) {
    if (e instanceof ApiServerError && e.statusCode === 401) redirect('/client/login');
    if (e instanceof ApiServerError && e.statusCode === 404) redirect('/portal/case');
  }

  if (!data) redirect('/portal/case');

  return <ScorecardResultClient data={data!} />;
}
