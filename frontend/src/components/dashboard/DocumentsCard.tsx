'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FileText, CheckCircle2, Circle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { visaStepHref } from '@/lib/visa-step-slugs';

// PR-DASH-1 — Required documents card.
//
// Vertical list of every document type this student should provide
// (computed server-side from their visa flags — see
// DashboardService.buildRequiredDocs). Each row links back to the
// visa step that owns the picker so a click takes the student
// straight to where they can record the file.
//
// Provided rows render a green check + the original filename; needed
// rows render a hollow circle and a gold "Needed" badge.

export type DocStatus = {
  documentType: string;
  provided: boolean;
  originalFilename?: string;
};

// Document type → visa step that owns the picker. Page-1 documents
// live on Step 13; page-2 documents live on Step 14. The dashboard
// uses this map to deep-link each row.
const DOC_TO_STEP: Record<string, number> = {
  PASSPORT:                       13,
  NATIONAL_ID:                    13,
  RESIDENCE_VISA:                 13,
  MILITARY_RECORD:                13,
  TRAVEL_HISTORY:                 13,
  AUTHORITY_DOC:                  13,
  OFFER_OF_PLACE:                 14,
  PHD_RESEARCH_PROPOSAL:          14,
  PUBLICATIONS_LIST:              14,
  PERSONAL_CIRCUMSTANCES_EVIDENCE: 14,
  PREVIOUS_TERTIARY_EVIDENCE:     14,
  CURRENT_EMPLOYMENT_EVIDENCE:    14,
  PREVIOUS_EMPLOYMENT_EVIDENCE:   14,
  ENGLISH_TEST_RESULTS:           14,
  TUITION_PAYMENT_CONFIRMATION:   14,
  INZ1014_FINANCIAL_UNDERTAKING:  14,
  PREPAID_ACCOMMODATION_EVIDENCE: 14,
  SCHOLARSHIP_EVIDENCE:           14,
  OUTWARD_TRAVEL_EVIDENCE:        14,
  BANK_STATEMENTS:                14,
  EMPLOYMENT_INCOME_EVIDENCE:     14,
  SCHEDULED_HOLIDAY_EVIDENCE:     14,
  OTHER_EVIDENCE:                 14,
};

// Maps a documentType to its visa-section i18n label key. The visa
// section already owns the per-document labels; we reuse them rather
// than duplicate the copy here.
function labelKeyFor(documentType: string): string {
  // Page-1 keys
  switch (documentType) {
    case 'PASSPORT':        return 'visaDocsDocPassport';
    case 'NATIONAL_ID':     return 'visaDocsDocNationalId';
    case 'RESIDENCE_VISA':  return 'visaDocsDocResidenceVisa';
    case 'MILITARY_RECORD': return 'visaDocsDocMilitaryRecord';
    case 'TRAVEL_HISTORY':  return 'visaDocsDocTravelHistory';
    case 'AUTHORITY_DOC':   return 'visaDocsDocAuthority';
    case 'OFFER_OF_PLACE':                  return 'visaDocs2DocOfferOfPlace';
    case 'PHD_RESEARCH_PROPOSAL':           return 'visaDocs2DocPhdResearchProposal';
    case 'PUBLICATIONS_LIST':               return 'visaDocs2DocPublicationsList';
    case 'PERSONAL_CIRCUMSTANCES_EVIDENCE': return 'visaDocs2DocPersonalCircumstancesEvidence';
    case 'PREVIOUS_TERTIARY_EVIDENCE':      return 'visaDocs2DocPreviousTertiaryEvidence';
    case 'CURRENT_EMPLOYMENT_EVIDENCE':     return 'visaDocs2DocCurrentEmploymentEvidence';
    case 'PREVIOUS_EMPLOYMENT_EVIDENCE':    return 'visaDocs2DocPreviousEmploymentEvidence';
    case 'ENGLISH_TEST_RESULTS':            return 'visaDocs2DocEnglishTestResults';
    case 'TUITION_PAYMENT_CONFIRMATION':    return 'visaDocs2DocTuitionPaymentConfirmation';
    case 'INZ1014_FINANCIAL_UNDERTAKING':   return 'visaDocs2DocInz1014';
    case 'PREPAID_ACCOMMODATION_EVIDENCE':  return 'visaDocs2DocPrepaidAccommodation';
    case 'SCHOLARSHIP_EVIDENCE':            return 'visaDocs2DocScholarshipEvidence';
    case 'OUTWARD_TRAVEL_EVIDENCE':         return 'visaDocs2DocOutwardTravel';
    case 'BANK_STATEMENTS':                 return 'visaDocs2DocBankStatements';
    case 'EMPLOYMENT_INCOME_EVIDENCE':      return 'visaDocs2DocEmploymentIncomeEvidence';
    case 'SCHEDULED_HOLIDAY_EVIDENCE':      return 'visaDocs2DocScheduledHoliday';
    default:                                return 'visaDocs2EvidenceType_OTHER';
  }
}

export function DocumentsCard({ documents }: { documents: DocStatus[] }) {
  const t = useTranslations();
  return (
    <Card className="bg-white animate-fade-in-up md:col-span-2">
      <CardHeader className="flex flex-row items-center gap-3">
        <div className="rounded-lg bg-[#1e3a5f]/5 p-2 text-[#1e3a5f]">
          <FileText size={20} />
        </div>
        <CardTitle>{t('dashboard.documents.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="text-sm text-slate-500">{t('dashboard.documents.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100">
            {documents.map((d) => {
              const step = DOC_TO_STEP[d.documentType] ?? 14;
              return (
                <li key={d.documentType}>
                  <Link
                    href={visaStepHref(step)}
                    className="flex items-center justify-between gap-3 py-3 transition-colors hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-3">
                      {d.provided ? (
                        <CheckCircle2 size={20} className="text-emerald-500" />
                      ) : (
                        <Circle size={20} className="text-slate-300" />
                      )}
                      <div>
                        <p className="text-sm font-medium text-[#1e3a5f]">
                          {t(labelKeyFor(d.documentType) as Parameters<typeof t>[0])}
                        </p>
                        {d.provided && d.originalFilename && (
                          <p className="text-xs text-slate-500">{d.originalFilename}</p>
                        )}
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        d.provided
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {d.provided
                        ? t('dashboard.documents.provided')
                        : t('dashboard.documents.needed')}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
