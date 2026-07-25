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

// PR-OWNER-DOCS — the SINGLE canonical "can this role SEE this document?" rule,
// used by BOTH the per-case list, the cross-case list, and the download gate, so
// visibility can never diverge between them. Encodes the Operations Manual
// permission matrix:
//   • LIA + admin tier (OWNER/SUPER_ADMIN/ADMIN) — everything, incl. visa/INZ.
//   • CONSULTANT (Admission Officer) — Priority-1 documents ONLY, and NEVER the
//     visa source (the Manual: Admission Specialist has no access to the visa/INZ
//     file), regardless of an individual doc's type classification.
//   • CLIENT_CONSULTANT (Client Officer) — the full client file (P1 + P2) EXCEPT
//     the visa source (visa/INZ stays LIA-only).
//   • OPERATIONS — all non-visa (legacy OPS reviewer role).
//   • Any other role — unchanged prior behaviour (sees the document).
export function canRoleViewDocument(
  role: string | null | undefined,
  source: CaseDocumentReviewSource,
  docType: string,
): boolean {
  // Roles explicitly barred from the visa/INZ source by the Operations Manual.
  const barredFromVisa =
    role === 'CONSULTANT' || role === 'CLIENT_CONSULTANT' || role === 'OPERATIONS';
  if (source === 'VISA_SUPPORTING' && barredFromVisa) return false;
  // Admission Officer: Priority-1 (educational) documents only, across the
  // non-visa sources it CAN see.
  if (role === 'CONSULTANT') return documentPriority(source, docType) === 'P1';
  // LIA / admin tier (everything incl. visa), Client Officer / Operations (all
  // non-visa), and any other role — the document is visible.
  return true;
}
