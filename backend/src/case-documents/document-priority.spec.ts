/**
 * PR-OWNER-DOCS — the document visibility matrix (canRoleViewDocument), the single
 * canonical rule shared by the per-case list, the cross-case list, and the
 * download gate. Pure logic, exhaustive over role × source × priority.
 */

import { documentPriority, canRoleViewDocument } from './document-priority';

describe('documentPriority', () => {
  it('classifies ADMISSION types', () => {
    expect(documentPriority('ADMISSION', 'PASSPORT')).toBe('P1');
    expect(documentPriority('ADMISSION', 'EDUCATION_TRANSCRIPTS')).toBe('P1');
    expect(documentPriority('ADMISSION', 'VISA_POLICE_CERTIFICATE')).toBe('P2');
    expect(documentPriority('ADMISSION', 'NZ_VISA_HISTORY')).toBe('P2');
    expect(documentPriority('ADMISSION', 'SUPPORTING_DOCUMENT')).toBe('P2'); // ambiguous → P2
  });
  it('classifies VISA_SUPPORTING types', () => {
    expect(documentPriority('VISA_SUPPORTING', 'OFFER_OF_PLACE')).toBe('P1');
    expect(documentPriority('VISA_SUPPORTING', 'ENGLISH_TEST_RESULTS')).toBe('P1');
    expect(documentPriority('VISA_SUPPORTING', 'BANK_STATEMENTS')).toBe('P2');
    expect(documentPriority('VISA_SUPPORTING', 'CURRENT_EMPLOYMENT_EVIDENCE')).toBe('P2');
  });
  it('APPLICATION source is always P2', () => {
    expect(documentPriority('APPLICATION', 'anything')).toBe('P2');
  });
});

describe('canRoleViewDocument — the access matrix', () => {
  const P1_ADM = ['ADMISSION', 'PASSPORT'] as const;              // P1, non-visa
  const P2_ADM = ['ADMISSION', 'VISA_POLICE_CERTIFICATE'] as const; // P2, non-visa
  const P1_VISA = ['VISA_SUPPORTING', 'OFFER_OF_PLACE'] as const; // P1 TYPE but visa source
  const P2_VISA = ['VISA_SUPPORTING', 'BANK_STATEMENTS'] as const; // P2, visa source

  const can = (role: string, doc: readonly [any, string]) => canRoleViewDocument(role, doc[0], doc[1]);

  it.each(['OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA'])('%s (read-all) sees everything incl. visa', (role) => {
    expect(can(role, P1_ADM)).toBe(true);
    expect(can(role, P2_ADM)).toBe(true);
    expect(can(role, P1_VISA)).toBe(true);
    expect(can(role, P2_VISA)).toBe(true);
  });

  it('CONSULTANT (Admission Officer): P1 non-visa ONLY — never visa, never P2', () => {
    expect(can('CONSULTANT', P1_ADM)).toBe(true);
    expect(can('CONSULTANT', P2_ADM)).toBe(false);   // P2 hidden
    expect(can('CONSULTANT', P1_VISA)).toBe(false);  // P1-typed but visa source → hidden
    expect(can('CONSULTANT', P2_VISA)).toBe(false);
  });

  it('CLIENT_CONSULTANT (Client Officer): P1+P2 non-visa — never visa', () => {
    expect(can('CLIENT_CONSULTANT', P1_ADM)).toBe(true);
    expect(can('CLIENT_CONSULTANT', P2_ADM)).toBe(true);   // sees P2
    expect(can('CLIENT_CONSULTANT', P1_VISA)).toBe(false); // visa source hidden
    expect(can('CLIENT_CONSULTANT', P2_VISA)).toBe(false);
  });

  it('OPERATIONS: all non-visa (legacy reviewer role)', () => {
    expect(can('OPERATIONS', P1_ADM)).toBe(true);
    expect(can('OPERATIONS', P2_ADM)).toBe(true);
    expect(can('OPERATIONS', P1_VISA)).toBe(false);
    expect(can('OPERATIONS', P2_VISA)).toBe(false);
  });
});
