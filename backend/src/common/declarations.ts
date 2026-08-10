// PR-PHASE39 — the canonical text of every in-form declaration.
//
// WHY THE TEXT LIVES HERE AND NOT ON THE CLIENT. The audit row has to say what
// the client agreed to, and a client-supplied string cannot carry that weight:
// anything the browser sends can be edited before it is sent, so a record built
// from it proves only what the browser claimed. These constants are the
// server's own copy, written into the row server-side.
//
// The cost of that choice is drift — the client renders from
// frontend/src/i18n/messages/en.json, and nothing stops the two from parting
// company. `declarations.spec.ts` reads that file and fails if a single
// character differs, so the drift is caught in CI rather than discovered in a
// dispute years later.
//
// The declarations are kept ENGLISH in both locales (Phase 29/30 decision #4).
// There is no Persian variant to snapshot.
//
// Bump the version whenever the wording changes. Old rows keep their own text
// AND their own version, so a change is never retroactive.

import { DeclarationType } from '@prisma/client';

export const DECLARATION_VERSION = 'declarations-v1-2026-08';

/** i18n keys the client renders, in the order they appear on screen. */
export const DECLARATION_MESSAGE_KEYS: Record<DeclarationType, string[]> = {
  AGENT_DECLARATION: ['admissionStep7DeclarationText'],
  ADMISSION_ACCEPTANCE: [
    'admissionStep8TermsP1',
    'admissionStep8TermsP2',
    'admissionStep8TermsP3',
    'admissionStep8TermsP4',
    'admissionStep8AcceptanceLabel',
  ],
  VISA_SUBMIT_DECLARATION: ['visaDocs2DeclarationCheckedLabel'],
};

// The literal strings, copied from en.json. Multi-paragraph declarations are
// stored joined by a blank line — one field holding everything the client read,
// in the order they read it.
const TEXTS: Record<DeclarationType, string[]> = {
  AGENT_DECLARATION: [
    'I confirm that I am authorised to act on behalf of this applicant and that the information I have provided is true and accurate to the best of my knowledge.',
  ],
  ADMISSION_ACCEPTANCE: [
    'By submitting this application, I confirm that all information I have provided is true, complete, and accurate to the best of my knowledge.',
    'I understand that Sorena Visa will process my personal information to assess my application and may share relevant details with partner education providers and immigration advisers where necessary to support my application.',
    'I consent to Sorena and its partner education providers contacting me about my application and related study opportunities.',
    'I acknowledge that providing false or misleading information may result in my application being rejected, or any subsequent offer being withdrawn.',
    'I have read and agree to the declaration above.',
  ],
  VISA_SUBMIT_DECLARATION: [
    'I have checked that the documents I have uploaded accurately represent the statements made in this form.',
  ],
};

/** The exact text to snapshot onto a PolicyAcceptance row. */
export function declarationText(type: DeclarationType): string {
  return TEXTS[type].join('\n\n');
}

/** Paragraphs as rendered, for the spec that compares against en.json. */
export function declarationParagraphs(type: DeclarationType): string[] {
  return TEXTS[type];
}
