import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { ScorecardForm } from '@/components/scorecard/ScorecardForm';
import { ScorecardHeader } from '@/components/scorecard/ScorecardHeader';
import { AboutSorenaBrief } from '@/components/scorecard/AboutSorenaBrief';

// PR-SCORECARD-2 — Public scorecard form page.
//
// Server component shell. Loads the user's open draft (if any) so the
// client form can hydrate with the saved answers. Path A (anonymous
// on-ramp): the scorecard is fillable WITHOUT an account — an
// unauthenticated visitor (401 on the draft load) is NOT bounced to the
// staff login; the empty form renders and the LEAD account is created on
// submit. Anonymous drafts live in localStorage (client-side).

interface InitialDraft {
  id: string;
  answers: Record<string, string>;
  draftLastSavedAt: string | null;
}

export default async function ScorecardFormPage() {
  let initialDraft: InitialDraft | null = null;
  let isAuthenticated = false;
  try {
    // The draft endpoint is auth-gated, so a success (even null draft) means
    // the caller is signed in; a 401 means an anonymous visitor.
    initialDraft = await apiServer.get<InitialDraft | null>('/scorecard/me/draft');
    isAuthenticated = true;
  } catch (e) {
    if (e instanceof ApiServerError && e.statusCode === 401) {
      // Anonymous — render the empty form (account created on submit).
      initialDraft = null;
      isAuthenticated = false;
    }
    // Other errors (e.g. 500) — fall through, treated as anonymous/no draft.
  }

  return (
    <div className="min-h-screen bg-[#FAF8F3]">
      <ScorecardHeader />
      <AboutSorenaBrief />
      <div className="py-6 px-4">
        <div className="max-w-3xl mx-auto mb-6">
          <Link
            href="/scorecard/landing"
            className="inline-flex items-center gap-1 text-sm text-[#1E3A5F]/70 hover:text-[#1E3A5F]"
          >
            <ChevronLeft size={14} /> Sorena Readiness Assessment
          </Link>
        </div>

        <ScorecardForm initialDraft={initialDraft} isAuthenticated={isAuthenticated} />
      </div>
    </div>
  );
}
