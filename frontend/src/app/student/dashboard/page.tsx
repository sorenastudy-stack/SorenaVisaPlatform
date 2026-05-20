import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { DashboardLayout, DashboardGrid } from '@/components/dashboard/DashboardLayout';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import {
  AssessmentReportCard,
  type AssessmentReportData,
} from '@/components/dashboard/AssessmentReportCard';
import { ProgressCard } from '@/components/dashboard/ProgressCard';
import { CaseStatusCard } from '@/components/dashboard/CaseStatusCard';
import { DocumentsCard, type DocStatus } from '@/components/dashboard/DocumentsCard';
import {
  RecentActivityCard,
  type ActivityItem,
} from '@/components/dashboard/RecentActivityCard';
import {
  TicketsCard,
  type DashboardTicketsSummary,
} from '@/components/tickets/TicketsCard';
import {
  MeetingsCard,
  type DashboardMeetingsSummary,
} from '@/components/student/meetings/MeetingsCard';
import { ChatbotCard } from '@/components/student/chat/ChatbotCard';

// PR-DASH-1 — Client dashboard landing page.
//
// Server component: fetches /students/me/dashboard on the server with
// the existing apiServer helper (cookie-bound auth). The backend
// auto-creates the VisaApplication / VisaCase / AssessmentReport rows
// on first hit so this page never needs to handle a "no data" state.
//
// Route: /student/dashboard (the project uses locale-flat routes —
// locale is a client-side store, not a URL segment).

interface DashboardPayload {
  user: { firstName: string };
  assessmentReport: AssessmentReportData;
  visaProgress: { currentStep: number; totalSteps: number; isComplete: boolean };
  case: {
    status: string;
    statusLabel: string;
    statusChangedAt: string;
    // PR-CONSULT-1: assignee names from the active VisaCaseAssignment
    // rows for the LIA + CONSULTANT slots. Null when the slot hasn't
    // been auto-allocated yet.
    assignedLia: string | null;
    assignedConsultant: string | null;
  };
  documents: DocStatus[];
  recentActivity: ActivityItem[];
  tickets: DashboardTicketsSummary;
  meetings: DashboardMeetingsSummary;
}

export default async function StudentDashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/student/dashboard');

  let payload: DashboardPayload | null = null;
  try {
    payload = await apiServer.get<DashboardPayload>('/students/me/dashboard');
  } catch (err) {
    // If the admission chain is broken for this student the dashboard
    // can't render — bounce them back to /student which lets them
    // start the admission flow or shows the right empty state.
    if (err instanceof ApiServerError && err.statusCode === 404) {
      redirect('/student');
    }
    throw err;
  }
  if (!payload) redirect('/student');

  return (
    <DashboardLayout>
      <DashboardHeader
        firstName={payload.user.firstName}
        status={payload.case.status}
      />

      <DashboardGrid>
        <AssessmentReportCard report={payload.assessmentReport} />
        <ProgressCard
          currentStep={payload.visaProgress.currentStep}
          totalSteps={payload.visaProgress.totalSteps}
          isComplete={payload.visaProgress.isComplete}
        />
        <CaseStatusCard
          status={payload.case.status}
          statusChangedAt={payload.case.statusChangedAt}
          assignedLia={payload.case.assignedLia}
          assignedConsultant={payload.case.assignedConsultant}
        />
        {/* PR-DASH-2: TicketsCard replaces the old placeholder. */}
        <TicketsCard summary={payload.tickets} />
        {/* PR-DASH-3: MeetingsCard replaces the old placeholder. */}
        <MeetingsCard summary={payload.meetings} />
        {/* PR-DASH-4: ChatbotCard replaces the old placeholder. */}
        <ChatbotCard />
        {/* DocumentsCard spans both columns on md+ */}
        <DocumentsCard documents={payload.documents} />
        <RecentActivityCard activity={payload.recentActivity} />
      </DashboardGrid>
    </DashboardLayout>
  );
}
