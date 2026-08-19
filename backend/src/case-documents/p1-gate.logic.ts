import { documentPriority, type DocumentPriority } from './document-priority';
import type { CaseDocumentReviewSource } from '@prisma/client';

// PR-CHECKLIST item 7 — the Priority-1 / Priority-2 progression gate.
//
// document-priority.ts already classifies every document type P1/P2 and enforces
// it as a VISIBILITY boundary (who may see what). This adds the second half the
// checklist actually asks for and which did not exist: a PROGRESSION rule. A
// client cannot start submitting Priority-2 material — medical, police, bank,
// financial — until their Priority-1 educational documents have been uploaded
// AND verified.
//
// Purely additive: the visibility rules are untouched, and this consults the
// same classifier so the two can never disagree about what P1 means.
//
// Note the branch that matters. "All P1 are approved" is TRUE of a client who
// has uploaded nothing at all, so a naive rule would wave through the first P2
// upload — precisely the case the gate exists to stop. An empty P1 set is
// therefore a CLOSED gate, not an open one.

export type ReviewStatus = 'UNREVIEWED' | 'APPROVED' | 'REJECTED';

export interface ExistingDocument {
  source: CaseDocumentReviewSource;
  docType: string;
  status: ReviewStatus;
}

export interface GateVerdict {
  allowed: boolean;
  /** Client-facing, and specific about which of the three reasons it is. */
  reason?: string;
}

const ALLOWED: GateVerdict = { allowed: true };

/**
 * May this client upload this document right now?
 *
 * P1 is always allowed — including a re-upload of a REJECTED P1, which is the
 * only way to ever open the gate.
 */
export function p1GateVerdict(
  existing: ExistingDocument[],
  incoming: { source: CaseDocumentReviewSource; docType: string },
): GateVerdict {
  if (documentPriority(incoming.source, incoming.docType) === 'P1') return ALLOWED;

  const p1 = existing.filter((d) => documentPriority(d.source, d.docType) === 'P1');

  if (p1.length === 0) {
    return {
      allowed: false,
      reason:
        'Please upload your educational documents (passport, transcripts, English test results) first. ' +
        'Once they have been verified you can upload the rest.',
    };
  }

  const rejected = p1.filter((d) => d.status === 'REJECTED');
  if (rejected.length > 0) {
    return {
      allowed: false,
      reason:
        'One or more of your educational documents was not accepted. ' +
        'Please re-upload it before adding further documents.',
    };
  }

  const unreviewed = p1.filter((d) => d.status === 'UNREVIEWED');
  if (unreviewed.length > 0) {
    return {
      allowed: false,
      reason:
        'Your educational documents are still being verified. ' +
        'You can upload the rest once that is complete — we will let you know.',
    };
  }

  return ALLOWED;
}

/** Exposed so callers can log/branch on the classification without re-deriving it. */
export function priorityOf(source: CaseDocumentReviewSource, docType: string): DocumentPriority {
  return documentPriority(source, docType);
}
