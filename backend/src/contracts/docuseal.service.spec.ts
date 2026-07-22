/**
 * PR-DOCUSEAL — unit tests for the pure, network-free parts of the DocuSeal
 * integration: the engagement-submitters builder (order + prefilled fields), the
 * submitter-status mapping, and the visaType extractor. The HTTP methods are not
 * exercised here (they hit the live DocuSeal API).
 */

import {
  buildEngagementSubmitters,
  docusealSubmitterStatus,
  DocusealService,
  DOCUSEAL_ROLE_CLIENT,
  DOCUSEAL_ROLE_LIA,
  DOCUSEAL_ROLE_DIRECTOR,
} from './docuseal.service';

describe('buildEngagementSubmitters', () => {
  const input = {
    client:   { email: 'oscar@example.com', name: 'Oscar Bach' },
    lia:      { email: 'sheila@sorenavisa.com', name: 'Sheila Rose' },
    director: { email: 'sorenastudy@gmail.com', name: 'Director' },
    iaaLicenceNo: '201900123',
  };

  it('returns the three submitters in signing order: Client → LIA → Director', () => {
    const subs = buildEngagementSubmitters(input);
    expect(subs.map((s) => s.role)).toEqual([
      DOCUSEAL_ROLE_CLIENT,
      DOCUSEAL_ROLE_LIA,
      DOCUSEAL_ROLE_DIRECTOR,
    ]);
    expect(subs.map((s) => s.email)).toEqual([
      'oscar@example.com',
      'sheila@sorenavisa.com',
      'sorenastudy@gmail.com',
    ]);
  });

  it('pre-fills the client name + email on the Client submitter', () => {
    const [client] = buildEngagementSubmitters(input);
    expect(client.values).toEqual({
      clientName: 'Oscar Bach',
      clientEmail: 'oscar@example.com',
    });
  });

  it('pre-fills liaName + iaaLicenceNo on the LIA submitter', () => {
    const lia = buildEngagementSubmitters(input)[1];
    expect(lia.values).toEqual({
      liaName: 'Sheila Rose',
      iaaLicenceNo: '201900123',
    });
  });

  it('sends a blank iaaLicenceNo (never undefined) when the LIA has none', () => {
    const lia = buildEngagementSubmitters({ ...input, iaaLicenceNo: null })[1];
    expect(lia.values?.iaaLicenceNo).toBe('');
  });

  it('leaves the Director submitter without prefilled values', () => {
    const director = buildEngagementSubmitters(input)[2];
    expect(director.values).toBeUndefined();
  });
});

describe('docusealSubmitterStatus', () => {
  it('maps DocuSeal statuses to our ContractSignerStatus names', () => {
    expect(docusealSubmitterStatus('awaiting')).toBe('PENDING');
    expect(docusealSubmitterStatus('sent')).toBe('SENT');
    expect(docusealSubmitterStatus('opened')).toBe('VIEWED');
    expect(docusealSubmitterStatus('completed')).toBe('SIGNED');
    expect(docusealSubmitterStatus('declined')).toBe('DECLINED');
  });

  it('returns null for unknown/missing statuses (row left unchanged)', () => {
    expect(docusealSubmitterStatus('weird')).toBeNull();
    expect(docusealSubmitterStatus(undefined)).toBeNull();
    expect(docusealSubmitterStatus(null)).toBeNull();
  });
});

describe('DocusealService.extractVisaType', () => {
  const svc = new DocusealService();

  it('reads the LIA submitter visaType (single value)', () => {
    const submission = {
      submitters: [
        { role: 'Client', values: [{ field: 'clientName', value: 'Oscar' }] },
        { role: 'LIA', values: [{ field: 'visaType', value: 'Student Visa' }] },
      ],
    };
    expect(svc.extractVisaType(submission)).toBe('Student Visa');
  });

  it('joins a multi-select visaType array', () => {
    const submission = {
      submitters: [
        { role: 'LIA', values: [{ field: 'visaType', value: ['Student Visa', 'Work Visa'] }] },
      ],
    };
    expect(svc.extractVisaType(submission)).toBe('Student Visa, Work Visa');
  });

  it('supports the "name" key as well as "field"', () => {
    const submission = {
      submitters: [{ role: 'LIA', values: [{ name: 'visaType', value: 'Visitor Visa' }] }],
    };
    expect(svc.extractVisaType(submission)).toBe('Visitor Visa');
  });

  it('returns null when no submitter has a visaType value', () => {
    const submission = {
      submitters: [{ role: 'LIA', values: [{ field: 'liaName', value: 'Sheila' }] }],
    };
    expect(svc.extractVisaType(submission)).toBeNull();
  });
});
