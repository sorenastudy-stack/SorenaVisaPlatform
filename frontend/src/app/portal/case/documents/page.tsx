import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { CaseDocumentsPanel } from '@/components/cases/CaseDocumentsPanel';

// Client portal step 3 — the client's documents page.
//
// Resolves the client's own caseId server-side via /portal/me/case
// (same endpoint as the case overview) then mounts the shared
// <CaseDocumentsPanel> with canDelete=false. The 5 /cases/:caseId/
// documents endpoints already accept the owning client per the
// documents-access helper; deletion is forbidden server-side too,
// and the panel hides the Remove button when canDelete is false.

interface MyCaseLite {
  id: string;
}

export default async function MyDocumentsPage() {
  const t = await getTranslations();

  let caseId: string | null = null;
  let notFound = false;
  let loadError = false;

  try {
    const { id } = await apiServer.get<MyCaseLite>('/portal/me/case');
    caseId = id;
  } catch (err) {
    if (err instanceof ApiServerError && err.statusCode === 404) {
      notFound = true;
    } else {
      loadError = true;
    }
  }

  if (notFound) {
    return (
      <section className="rounded-2xl bg-white border border-gray-200 p-8 md:p-12 text-center">
        <h1 className="text-xl md:text-2xl font-bold text-[#1e3a5f] mb-2">
          {t('portal.case.noCase.title')}
        </h1>
        <p className="text-sm text-gray-600 leading-relaxed max-w-md mx-auto">
          {t('portal.case.noCase.body')}
        </p>
      </section>
    );
  }

  if (loadError || !caseId) {
    return (
      <section className="rounded-2xl bg-white border border-gray-200 p-8 text-center">
        <h1 className="text-lg font-bold text-[#1e3a5f] mb-2">
          {t('portal.case.loadError.title')}
        </h1>
        <p className="text-sm text-gray-600">
          {t('portal.case.loadError.body')}
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/portal/case"
          className="inline-flex items-center gap-1.5 text-sm text-[#1e3a5f]/70 hover:text-[#1e3a5f] transition-colors"
        >
          <ArrowLeft size={16} />
          {t('portal.documents.backLink')}
        </Link>
        <h1 className="text-2xl font-bold text-[#1e3a5f] mt-2">
          {t('portal.documents.heading')}
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          {t('portal.documents.subheading')}
        </p>
      </div>

      {/* Shared component — clients see no Delete button. */}
      <CaseDocumentsPanel caseId={caseId} canDelete={false} />
    </div>
  );
}
