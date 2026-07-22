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

  // Field names are the LIVE template's human-readable names (verified against
  // GET /api/templates/1), not machine keys.
  it('pre-fills the client Full Name + Email on the Client submitter', () => {
    const [client] = buildEngagementSubmitters(input);
    expect(client.values).toEqual({
      'Full Name': 'Oscar Bach',
      'Email': 'oscar@example.com',
    });
  });

  it('pre-fills Full Name + IAA Licence No on the LIA submitter', () => {
    const lia = buildEngagementSubmitters(input)[1];
    expect(lia.values).toEqual({
      'Full Name': 'Sheila Rose',
      'IAA Licence No': '201900123',
    });
  });

  it('sends a blank IAA Licence No (never undefined) when the LIA has none', () => {
    const lia = buildEngagementSubmitters({ ...input, iaaLicenceNo: null })[1];
    expect(lia.values?.['IAA Licence No']).toBe('');
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

describe('DocusealService.extractVisaType (checkbox group)', () => {
  const svc = new DocusealService();

  it('returns the name of the single checked visa-type checkbox', () => {
    const submission = {
      submitters: [
        { role: 'Client', values: [{ field: 'Full Name', value: 'Oscar' }] },
        {
          role: 'LIA',
          values: [
            { field: 'Full Name', value: 'Sheila' },
            { field: 'Initial Student Visa', value: true },
            { field: 'Visitor Visa', value: false },
          ],
        },
      ],
    };
    expect(svc.extractVisaType(submission)).toBe('Initial Student Visa');
  });

  it('joins multiple checked visa-type checkboxes', () => {
    const submission = {
      submitters: [
        {
          role: 'LIA',
          values: [
            { field: 'Initial Student Visa', value: 'true' },
            { field: 'Visitor Visa', value: true },
          ],
        },
      ],
    };
    expect(svc.extractVisaType(submission)).toBe('Initial Student Visa, Visitor Visa');
  });

  it('ignores non-visa fields and unchecked boxes', () => {
    const submission = {
      submitters: [
        {
          role: 'LIA',
          values: [
            { field: 'IAA Licence No', value: '2019123' },
            { field: 'Student Visa Renewal', value: false },
            { field: 'Visitor Visa', value: '' },
          ],
        },
      ],
    };
    expect(svc.extractVisaType(submission)).toBeNull();
  });

  it('returns null when the submission has no visa checkboxes at all', () => {
    const submission = {
      submitters: [{ role: 'LIA', values: [{ field: 'Full Name', value: 'Sheila' }] }],
    };
    expect(svc.extractVisaType(submission)).toBeNull();
  });
});
