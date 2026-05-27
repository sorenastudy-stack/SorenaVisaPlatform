import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { ScorecardForm } from '@/components/scorecard/ScorecardForm';

// PR-SCORECARD-2 — Public scorecard form page.
//
// Server component shell. Loads the user's open draft (if any) so the
// client form can hydrate with the saved answers. If the user is not
// authenticated (401), bounces to /login with a returnTo so they come
// straight back here after signing in.

interface InitialDraft {
  id: string;
  answers: Record<string, string>;
  draftLastSavedAt: string | null;
}

export default async function ScorecardFormPage() {
  let initialDraft: InitialDraft | null = null;
  try {
    initialDraft = await apiServer.get<InitialDraft | null>('/scorecard/me/draft');
  } catch (e) {
    if (e instanceof ApiServerError && e.statusCode === 401) {
      redirect('/login?returnTo=/scorecard');
    }
    // Other errors (e.g. 500) — fall through with no draft.
  }

  return (
    <div className="min-h-screen bg-[#FAF8F3] py-10 px-4">
      <div className="max-w-3xl mx-auto mb-6">
        <Link
          href="/scorecard/landing"
          className="inline-flex items-center gap-1 text-sm text-[#1E3A5F]/70 hover:text-[#1E3A5F]"
        >
          <ChevronLeft size={14} /> Sorena Readiness Assessment
        </Link>
      </div>

      <ScorecardForm initialDraft={initialDraft} />
    </div>
  );
}
