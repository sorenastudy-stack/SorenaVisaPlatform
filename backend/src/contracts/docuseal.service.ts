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
        clientName: input.client.name,
        clientEmail: input.client.email,
      },
    },
    {
      role: DOCUSEAL_ROLE_LIA,
      email: input.lia.email,
      name: input.lia.name,
      values: {
        liaName: input.lia.name,
        iaaLicenceNo: input.iaaLicenceNo ?? '',
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

  // Extract the LIA's visaType selection from a fetched submission. visaType is a
  // multi-select; DocuSeal returns the value as an array or a comma string. We
  // normalise to a single free-text string for Case.visaType.
  extractVisaType(submission: any): string | null {
    const submitters: any[] = submission?.submitters ?? [];
    // Prefer the LIA submitter (by role); fall back to scanning every submitter.
    const ordered = [
      ...submitters.filter(
        (s) => (s.role ?? '').toLowerCase() === DOCUSEAL_ROLE_LIA.toLowerCase(),
      ),
      ...submitters,
    ];
    for (const sub of ordered) {
      const values: any[] = Array.isArray(sub?.values) ? sub.values : [];
      const hit = values.find((v) => (v.field ?? v.name) === 'visaType');
      if (hit && hit.value != null && hit.value !== '') {
        return Array.isArray(hit.value) ? hit.value.join(', ') : String(hit.value);
      }
    }
    return null;
  }
}
