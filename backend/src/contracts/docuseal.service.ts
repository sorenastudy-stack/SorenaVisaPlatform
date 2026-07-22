import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import axios from 'axios';

// PR-DOCUSEAL — DocuSeal (self-hosted) API client + engagement-submission
// builder. This is the ACTIVE contract provider (see CONTRACT_PROVIDER); the
// DocuSign service is retained intact for rollback. Mirrors DocuSignService's
// role: a thin injectable wrapper around the provider API plus the pure payload
// builder the send flow uses.
//
// Auth: every request carries the "X-Auth-Token" header (DOCUSEAL_API_TOKEN),
// read from the environment — never hardcoded.

// Template submitter role/party names. These MUST match the party names on the
// DocuSeal engagement template (id = DOCUSEAL_TEMPLATE_ID). Confirm them in the
// DocuSeal template editor; if the template uses different names, change these.
export const DOCUSEAL_ROLE_CLIENT = 'Client';
export const DOCUSEAL_ROLE_LIA = 'LIA';
export const DOCUSEAL_ROLE_DIRECTOR = 'Director';

// Template FIELD names — verified verbatim against GET /api/templates/1 on the
// live instance. The template uses human-readable field names (NOT machine keys
// like "clientName"), so prefill `values` must key by these exact strings. Note
// "Full Name" is reused per party; DocuSeal scopes `values` to each submitter,
// so the Client "Full Name" and LIA "Full Name" don't collide.
const FIELD_FULL_NAME = 'Full Name';
const FIELD_EMAIL = 'Email';
const FIELD_IAA_LICENCE_NO = 'IAA Licence No';

// The LIA's visa-type selection is a GROUP of checkbox fields (one per visa
// type) on the template — there is no single "visaType" field. On completion we
// return the name(s) of the checked box(es). Names are verbatim from the
// template; any edit there must be mirrored here.
export const VISA_CHECKBOX_FIELDS: readonly string[] = [
  'Initial Student Visa',
  'Student Visa Renewal',
  'Post-Study Work Visa (PSWV)',
  'Dependent Partner Work Visa',
  'Dependent Child Visa (per child)',
  'Dependent Partner Visa Renewal',
  'Dependent Child Visa Renewal (per child)',
  'Visitor Visa',
  'Work Visa (post-study, employer-sponsored)',
  'Visa Variation / Condition Change',
  'Visa Resubmission (one resubmission per declined visa)',
];

export interface DocusealSubmitterSpec {
  role: string;
  email: string;
  name: string;
  // Pre-filled field values, keyed by the template field name.
  values?: Record<string, string>;
  externalId?: string;
}

// Pure builder — the three ordered submitters for the engagement letter with the
// known fields pre-filled. Client → LIA → Director (signing order enforced by
// `order: 'preserved'` on the submission). Unit-tested.
export function buildEngagementSubmitters(input: {
  client: { email: string; name: string };
  lia: { email: string; name: string };
  director: { email: string; name: string };
  iaaLicenceNo: string | null;
}): DocusealSubmitterSpec[] {
  return [
    {
      role: DOCUSEAL_ROLE_CLIENT,
      email: input.client.email,
      name: input.client.name,
      values: {
        [FIELD_FULL_NAME]: input.client.name,
        [FIELD_EMAIL]: input.client.email,
      },
    },
    {
      role: DOCUSEAL_ROLE_LIA,
      email: input.lia.email,
      name: input.lia.name,
      values: {
        [FIELD_FULL_NAME]: input.lia.name,
        [FIELD_IAA_LICENCE_NO]: input.iaaLicenceNo ?? '',
      },
    },
    {
      role: DOCUSEAL_ROLE_DIRECTOR,
      email: input.director.email,
      name: input.director.name,
    },
  ];
}

// DocuSeal submitter status → our ContractSignerStatus name. Plain-string map so
// this module stays Prisma-free; the caller applies it to the enum.
export function docusealSubmitterStatus(
  s: string | null | undefined,
): 'PENDING' | 'SENT' | 'VIEWED' | 'SIGNED' | 'DECLINED' | null {
  switch (s) {
    case 'awaiting': return 'PENDING';
    case 'sent': return 'SENT';
    case 'opened': return 'VIEWED';
    case 'completed': return 'SIGNED';
    case 'declined': return 'DECLINED';
    default: return null;
  }
}

@Injectable()
export class DocusealService {
  private readonly logger = new Logger(DocusealService.name);

  private get baseUrl(): string {
    return (process.env.DOCUSEAL_BASE_URL ?? '').replace(/\/+$/, '');
  }
  private get apiToken(): string {
    return process.env.DOCUSEAL_API_TOKEN ?? '';
  }
  get templateId(): string {
    return process.env.DOCUSEAL_TEMPLATE_ID ?? '';
  }

  private assertConfigured(): void {
    const missing: string[] = [];
    if (!this.baseUrl) missing.push('DOCUSEAL_BASE_URL');
    if (!this.apiToken) missing.push('DOCUSEAL_API_TOKEN');
    if (!this.templateId) missing.push('DOCUSEAL_TEMPLATE_ID');
    if (missing.length) {
      throw new InternalServerErrorException(
        `DocuSeal not configured — set ${missing.join(', ')} in the environment`,
      );
    }
  }

  private headers(): Record<string, string> {
    return { 'X-Auth-Token': this.apiToken, 'Content-Type': 'application/json' };
  }

  // POST /api/submissions — create the engagement submission from the template.
  // Returns the submission id (string) + the created submitter rows.
  async createSubmission(
    submitters: DocusealSubmitterSpec[],
    opts: { sendEmail?: boolean; order?: 'preserved' | 'random' } = {},
  ): Promise<{ submissionId: string; submitters: any[] }> {
    this.assertConfigured();
    const body = {
      template_id: Number(this.templateId),
      send_email: opts.sendEmail ?? true,
      order: opts.order ?? 'preserved',
      submitters: submitters.map((s) => ({
        role: s.role,
        email: s.email,
        name: s.name,
        ...(s.values ? { values: s.values } : {}),
        ...(s.externalId ? { external_id: s.externalId } : {}),
      })),
    };
    try {
      const res = await axios.post(`${this.baseUrl}/api/submissions`, body, {
        headers: this.headers(),
      });
      const data = res.data;
      const rows: any[] = Array.isArray(data) ? data : data?.submitters ?? [];
      const submissionId = String(rows[0]?.submission_id ?? data?.id ?? '');
      if (!submissionId) {
        throw new Error('no submission id in response');
      }
      this.logger.log(
        `DocuSeal submission ${submissionId} created from template ${this.templateId} (${rows.length} submitters)`,
      );
      return { submissionId, submitters: rows };
    } catch (err: any) {
      const detail = err?.response
        ? `${err.response.status} ${JSON.stringify(err.response.data)}`
        : err?.message;
      throw new Error(`DocuSeal createSubmission failed: ${detail}`);
    }
  }

  // GET /api/submissions/:id — authoritative submission state (status, submitters
  // with their completed values). The webhook re-fetches this rather than trust
  // the POST body.
  async getSubmission(submissionId: string | number): Promise<any> {
    this.assertConfigured();
    try {
      const res = await axios.get(`${this.baseUrl}/api/submissions/${submissionId}`, {
        headers: this.headers(),
      });
      return res.data;
    } catch (err: any) {
      const detail = err?.response
        ? `${err.response.status} ${JSON.stringify(err.response.data)}`
        : err?.message;
      throw new Error(`DocuSeal getSubmission failed: ${detail}`);
    }
  }

  // Download the completed/signed PDF as bytes. GET /api/submissions/:id/documents
  // returns { documents: [{ name, url }] }; we fetch the first document's URL.
  async downloadCompletedPdf(submissionId: string | number): Promise<Buffer> {
    this.assertConfigured();
    try {
      const list = await axios.get(
        `${this.baseUrl}/api/submissions/${submissionId}/documents`,
        { headers: this.headers() },
      );
      const docs: any[] = list.data?.documents ?? [];
      const url = docs[0]?.url;
      if (!url) throw new Error('no document url in submission documents');
      const file = await axios.get(url, {
        headers: this.headers(),
        responseType: 'arraybuffer',
      });
      return Buffer.from(file.data);
    } catch (err: any) {
      const detail = err?.response ? `${err.response.status}` : err?.message;
      throw new Error(`DocuSeal downloadCompletedPdf failed: ${detail}`);
    }
  }

  // Extract the LIA's visa-type selection from a fetched submission. The template
  // captures it as a group of checkbox fields (VISA_CHECKBOX_FIELDS), so we
  // collect the names of every CHECKED box and join them into the free-text
  // Case.visaType. Returns null when nothing is selected.
  extractVisaType(submission: any): string | null {
    const submitters: any[] = submission?.submitters ?? [];
    const checkboxSet = new Set(VISA_CHECKBOX_FIELDS);
    const selected: string[] = [];
    for (const sub of submitters) {
      const values: any[] = Array.isArray(sub?.values) ? sub.values : [];
      for (const v of values) {
        const field = v?.field ?? v?.name;
        if (checkboxSet.has(field) && isCheckboxChecked(v?.value) && !selected.includes(field)) {
          selected.push(field);
        }
      }
    }
    return selected.length ? selected.join(', ') : null;
  }
}

// DocuSeal renders a checked checkbox value in a few shapes across versions
// (boolean true, the string "true"/"checked", or the field's own label). Treat
// any of those as checked; an empty / false / missing value is unchecked.
function isCheckboxChecked(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v !== '' && v !== 'false' && v !== '0' && v !== 'off' && v !== 'unchecked';
  }
  return false;
}
