import { CaseDocumentReviewSource } from '@prisma/client';

// Phase 5d — document priority classification (the compliance boundary).
//
// The Admission Specialist (auth role CONSULTANT, owner slot) may see ONLY
// Priority-1 (educational) documents; Priority-2 (medical/police/bank/financial/
// security/visa-history/refusal + anything ambiguous) is hidden from them. LIA +
// admin tier are unaffected (they see everything) — this map is only consulted
// for the CONSULTANT view (list filter + download-url gate in
// case-documents.service.ts).
//
// Classification is by document TYPE, never by source: a P2 type may live in a
// P1-looking source and vice-versa (e.g. VISA_POLICE_CERTIFICATE is P2 yet lives
// in the ADMISSION source; OFFER_OF_PLACE is P1 yet lives in VISA_SUPPORTING).
// So we gate on the type, not the source.
//
// Pure logic over the existing enum values — NO schema, NO column, NO migration.
// Defaults are SAFE: any unmapped/unknown type, and all free-string APPLICATION
// documents, resolve to P2 (hidden).

export type DocumentPriority = 'P1' | 'P2';

// P1 (educational) AdmissionDocumentType values — keyed by the raw enum string.
const ADMISSION_P1: ReadonlySet<string> = new Set<string>([
  'PASSPORT',
  'ENGLISH_TEST_EVIDENCE',
  'EDUCATION_TRANSCRIPTS',
  'NOTARIZED_CERTIFICATE',
  'NOTARIZED_TRANSCRIPT',
  'VISA_PHOTO',
]);

// P1 (educational) VisaSupportingDocumentType values. Note these are the
// educational docs that happen to live in the visa-supporting source (e.g. the
// offer of place), which a type-based rule correctly surfaces to the Admission
// Specialist while still hiding the financial/security types in the same source.
const VISA_SUPPORTING_P1: ReadonlySet<string> = new Set<string>([
  'OFFER_OF_PLACE',
  'ENGLISH_TEST_RESULTS',
  'PASSPORT',
  'NATIONAL_ID',
  'PHD_RESEARCH_PROPOSAL',
  'PUBLICATIONS_LIST',
  'PREVIOUS_TERTIARY_EVIDENCE',
  'SCHOLARSHIP_EVIDENCE',
]);

// Classify a document by (source, type). Returns 'P1' only for the explicitly
// educational types in the two typed enums; everything else — including every
// APPLICATION free-string document and any unmapped/unknown type — is 'P2'.
export function documentPriority(
  source: CaseDocumentReviewSource,
  docType: string,
): DocumentPriority {
  if (source === 'ADMISSION') {
    return ADMISSION_P1.has(docType) ? 'P1' : 'P2';
  }
  if (source === 'VISA_SUPPORTING') {
    return VISA_SUPPORTING_P1.has(docType) ? 'P1' : 'P2';
  }
  // APPLICATION (free-string `type`, unclassifiable) and any other source → P2.
  return 'P2';
}
