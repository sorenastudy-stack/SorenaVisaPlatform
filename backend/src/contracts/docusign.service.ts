import { Injectable, Logger } from '@nestjs/common';
import * as docusign from 'docusign-esign';
import * as fs from 'fs';
import * as path from 'path';

// PR-DOCUSIGN-1 step 5 — JWT-grant auth with in-memory token cache.
//
// Constructor stamps env into instance fields and warn-logs missing
// vars without crashing — the previous service's "DocuSign optional
// at boot" behaviour is preserved so the app still boots when this
// integration is unconfigured. Token mint is lazy: the first call to
// getAccessToken() reads the RSA private key, requests a JWT user
// token from DocuSign, and caches it. Subsequent calls within the
// cache window short-circuit without a network hop. The cache window
// is 5 min shorter than the DocuSign-advertised expires_in so an
// in-flight envelope op never races a token that's about to expire
// on DocuSign's side.
//
// DOCUSIGN_ACCESS_TOKEN is no longer read by this service. The line
// in backend/.env is deadweight from this commit forward — safe to
// delete locally (it's gitignored).

interface JwtTokenResponse {
  access_token?: string;
  expires_in?:   number;
  scope?:        string;
  token_type?:   string;
}

interface DocuSignSdkError {
  response?: {
    status?: number;
    body?: {
      error?:             string;
      error_description?: string;
      message?:           string;
    };
    text?: string;
  };
  message?: string;
}

// Buffer applied to the cache window: re-mint when we're within 5 min
// of the DocuSign-advertised expiry. Keeps in-flight envelope ops
// safe against clock skew + slow round-trips.
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
// SDK max for JWT user token lifetime is 3600s. We always request the
// max so the cache window is as wide as possible.
const TOKEN_LIFETIME_SECONDS = 3600;
const SCOPES = ['signature', 'impersonation'];

// ─── PR-DOCUSIGN-1 step 5h — composite-template envelope shape ──────────
//
// buildEnvelopeDefinition() is a PURE shape constructor for the
// engagement-letter envelope. The envelope uses a DocuSign composite
// template:
//
//   serverTemplates[0]: references our saved DocuSign template by
//     templateId; the template owns all field positions (signatures,
//     dates, full-name / passport text fields, the 11 visa-type
//     checkboxes + their pick-exactly-one group) and the recipient
//     role definitions ("Client" / "LIA" / "Director").
//
//   inlineTemplates[0]: supplies per-send identity — three Signers
//     keyed to the template's roleNames, with email + name + routing
//     order from the call site.
//
//   compositeTemplate.document: our freshly STAMPED engagement-letter
//     PDF (the LIA's name + IAA Licence Number drawn into the static
//     content layer by stampLiaIdentity() in engagement-letter-stamp.ts).
//     DocuSign substitutes this document for the template's stored copy
//     and overlays the template's field layout on top. The substituted
//     PDF MUST preserve the template's page count + dimensions; pdf-lib
//     stamping is purely additive so this invariant holds.
//
// Tabs are NOT constructed in code any more. The template is the source
// of truth for field positions; this builder only supplies identities
// and the substituted document.

// Template role names — must match the DocuSign template EXACTLY
// (case-sensitive). A typo breaks every send with TEMPLATE_ROLE_NOT_FOUND.
// These three strings are also the union type of EnvelopeRecipientSpec
// .templateRole below.
export const TEMPLATE_ROLE_CLIENT   = 'Client'   as const;
export const TEMPLATE_ROLE_LIA      = 'LIA'      as const;
export const TEMPLATE_ROLE_DIRECTOR = 'Director' as const;

export type TemplateRoleName =
  | typeof TEMPLATE_ROLE_CLIENT
  | typeof TEMPLATE_ROLE_LIA
  | typeof TEMPLATE_ROLE_DIRECTOR;

export interface EnvelopeRecipientSpec {
  recipientId:  string;            // '1' / '2' / '3' — DocuSign-side id within the envelope
  routingOrder: number;            // 1, 2, 3 — lower signs first; equal = parallel
  email:        string;
  name:         string;
  templateRole: TemplateRoleName;  // must match the saved DocuSign template's role name
}

export interface EnvelopeDocumentSpec {
  documentId:    string;     // '1' — single-document envelope only
  name:          string;     // shown in DocuSign UI
  fileExtension: string;     // 'pdf'
  bytes:         Buffer;     // STAMPED PDF — must match the template's source page count + dimensions
}

export interface BuildEnvelopeOptions {
  emailSubject: string;     // recipient email subject line
  emailBlurb:   string;     // recipient email body
  templateId:   string;     // DocuSign template UUID — the saved layout this envelope inherits from
}

// Sequence numbers for the composite-template arrays. DocuSign applies
// lower sequence first; inlineTemplate at sequence > serverTemplate so
// any inline overrides win.
const SERVER_TEMPLATE_SEQUENCE = '1';
const INLINE_TEMPLATE_SEQUENCE = '2';
const COMPOSITE_TEMPLATE_ID    = '1';

export function buildEnvelopeDefinition(
  documents: EnvelopeDocumentSpec[],
  signers:   EnvelopeRecipientSpec[],
  options:   BuildEnvelopeOptions,
): docusign.EnvelopeDefinition {
  if (documents.length !== 1) {
    throw new Error(
      `buildEnvelopeDefinition: composite-template send expects exactly 1 document, got ${documents.length}`,
    );
  }
  if (!options.templateId) {
    throw new Error(
      'buildEnvelopeDefinition: templateId is required for composite-template send',
    );
  }
  const docSpec = documents[0];

  const envelopeDefinition = new docusign.EnvelopeDefinition();
  envelopeDefinition.emailSubject = options.emailSubject;
  envelopeDefinition.emailBlurb   = options.emailBlurb;
  // status='sent' dispatches the envelope to the lowest-routingOrder
  // signer's email immediately on receipt by DocuSign.
  envelopeDefinition.status = 'sent';

  // ─── Substituted document — our stamped engagement letter ────────────
  const document = new docusign.Document();
  document.documentBase64 = docSpec.bytes.toString('base64');
  document.name           = docSpec.name;
  document.fileExtension  = docSpec.fileExtension;
  document.documentId     = docSpec.documentId;

  // ─── ServerTemplate — references the saved template's field layout ───
  const serverTemplate = new docusign.ServerTemplate();
  serverTemplate.sequence   = SERVER_TEMPLATE_SEQUENCE;
  serverTemplate.templateId = options.templateId;

  // ─── InlineTemplate — per-send recipient identities, no tabs ─────────
  // Each Signer.roleName binds to a template role; DocuSign attaches
  // that role's tabs from the template at send time. We deliberately
  // do NOT set signer.tabs — that's the template's job now.
  const sdkSigners = signers.map((s) => {
    const signer = new docusign.Signer();
    signer.recipientId  = s.recipientId;
    // SDK expects routingOrder as a string on the wire.
    signer.routingOrder = String(s.routingOrder);
    signer.email        = s.email;
    signer.name         = s.name;
    signer.roleName     = s.templateRole;
    return signer;
  });

  const recipients = new docusign.Recipients();
  recipients.signers = sdkSigners;

  const inlineTemplate = new docusign.InlineTemplate();
  inlineTemplate.sequence   = INLINE_TEMPLATE_SEQUENCE;
  inlineTemplate.recipients = recipients;

  const compositeTemplate = new docusign.CompositeTemplate();
  compositeTemplate.compositeTemplateId = COMPOSITE_TEMPLATE_ID;
  compositeTemplate.document            = document;
  compositeTemplate.serverTemplates     = [serverTemplate];
  compositeTemplate.inlineTemplates     = [inlineTemplate];

  envelopeDefinition.compositeTemplates = [compositeTemplate];
  return envelopeDefinition;
}

@Injectable()
export class DocuSignService {
  private readonly logger = new Logger(DocuSignService.name);

  // Env-stamped at construction. Empty strings if missing; the
  // missing-vars check moves to getAccessToken() so the app boots
  // even when DocuSign is temporarily unconfigured.
  private readonly accountId:      string;
  private readonly baseUrl:        string;
  private readonly integrationKey: string;
  private readonly userId:         string;
  private readonly oauthBase:      string;
  private readonly keyPath:        string;
  private readonly templateId:     string;

  // Lazy-loaded on first getAccessToken() call. Held as Buffer once
  // read; keeps the app boot resilient to a missing key file.
  private privateKey: Buffer | null = null;

  // Token cache. expiresAt carries the 5-min safety buffer pre-
  // subtracted so the inline expiry check is a simple now > expiresAt
  // comparison without re-doing the arithmetic on every call.
  private cachedToken: string | null = null;
  private expiresAt:   number = 0;
  private _mintCount:  number = 0;

  constructor() {
    this.accountId      = process.env.DOCUSIGN_ACCOUNT_ID       || '';
    this.baseUrl        = process.env.DOCUSIGN_BASE_URL         || '';
    this.integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY  || '';
    this.userId         = process.env.DOCUSIGN_USER_ID          || '';
    this.oauthBase      = process.env.DOCUSIGN_OAUTH_BASE       || '';
    this.keyPath        = process.env.DOCUSIGN_PRIVATE_KEY_PATH || '';
    this.templateId     = process.env.DOCUSIGN_TEMPLATE_ID      || '';

    const missing = this.listMissingEnv();
    if (missing.length > 0) {
      this.logger.warn(
        `DocuSign auth env vars missing — contract signing will be unavailable: ${missing.join(', ')}`,
      );
    }
  }

  // Public readonly getter, used by the cache probe. Stays at 1
  // across two consecutive getAccessToken() calls within the hour.
  get mintCount(): number {
    return this._mintCount;
  }

  // Seconds until the cache window closes (re-mint trigger). Reported
  // to the cache probe; production callers don't need this. Zero when
  // no token has been cached yet.
  get secondsUntilExpiry(): number {
    if (this.cachedToken === null) return 0;
    return Math.max(0, Math.floor((this.expiresAt - Date.now()) / 1000));
  }

  // ─── Token mint + cache ────────────────────────────────────────────

  // Public so the probe can call it directly. Production callers go
  // through createEnvelope / getSigningUrl / syncStatus which all use
  // makeAuthedApiClient() internally.
  async getAccessToken(): Promise<string> {
    if (this.cachedToken !== null && Date.now() < this.expiresAt) {
      return this.cachedToken;
    }

    const missing = this.listMissingEnv();
    if (missing.length > 0) {
      throw new Error(
        `DocuSign auth not configured — missing env vars: ${missing.join(', ')}`,
      );
    }

    const privateKey = this.loadPrivateKey();
    const apiClient = new docusign.ApiClient();
    apiClient.setOAuthBasePath(this.oauthBase);

    let result: { body: JwtTokenResponse };
    try {
      result = await apiClient.requestJWTUserToken(
        this.integrationKey,
        this.userId,
        SCOPES,
        privateKey,
        TOKEN_LIFETIME_SECONDS,
      );
    } catch (err) {
      throw this.shapeJwtError(err as DocuSignSdkError);
    }

    const body = result.body ?? {};
    if (!body.access_token || typeof body.expires_in !== 'number') {
      throw new Error(
        `DocuSign JWT response missing access_token or expires_in — got: ${JSON.stringify({
          hasToken: !!body.access_token,
          expiresIn: body.expires_in,
        })}`,
      );
    }

    this.cachedToken = body.access_token;
    this.expiresAt = Date.now() + body.expires_in * 1000 - EXPIRY_BUFFER_MS;
    this._mintCount += 1;
    return this.cachedToken;
  }

  // PR-DOCUSIGN-1 step 5h — composite-template send.
  //
  // Builds an envelope that inherits all field positions from the
  // saved DocuSign template (DOCUSIGN_TEMPLATE_ID) and supplies a
  // substituted document (the stamped engagement letter) plus the
  // three live recipients keyed to the template's role names.
  async createEnvelope(
    documents: EnvelopeDocumentSpec[],
    signers:   EnvelopeRecipientSpec[],
    options:   { emailSubject: string; emailBlurb: string; caseId: string },
  ): Promise<string> {
    if (!this.templateId) {
      throw new Error(
        'DocuSign template id not configured — set DOCUSIGN_TEMPLATE_ID in backend/.env',
      );
    }
    const apiClient = await this.makeAuthedApiClient();
    const envelopesApi = new docusign.EnvelopesApi(apiClient);
    const envelopeDefinition = buildEnvelopeDefinition(documents, signers, {
      emailSubject: options.emailSubject,
      emailBlurb:   options.emailBlurb,
      templateId:   this.templateId,
    });
    this.logger.log(
      `Creating envelope for case ${options.caseId} via template ${this.templateId} with ${signers.length} signers`,
    );
    const results = await envelopesApi.createEnvelope(this.accountId, {
      envelopeDefinition,
    });
    return results.envelopeId;
  }

  async getSigningUrl(
    envelopeId: string,
    signerEmail: string,
    signerName: string,
    returnUrl: string,
  ): Promise<string> {
    const apiClient = await this.makeAuthedApiClient();
    const envelopesApi = new docusign.EnvelopesApi(apiClient);

    const recipientViewRequest = new docusign.RecipientViewRequest();
    recipientViewRequest.returnUrl = returnUrl;
    recipientViewRequest.authenticationMethod = 'none';
    recipientViewRequest.email = signerEmail;
    recipientViewRequest.userName = signerName;
    recipientViewRequest.clientUserId = '1';

    const results = await envelopesApi.createRecipientView(
      this.accountId,
      envelopeId,
      { recipientViewRequest },
    );

    return results.url;
  }

  async syncStatus(envelopeId: string): Promise<any> {
    const apiClient = await this.makeAuthedApiClient();
    const envelopesApi = new docusign.EnvelopesApi(apiClient);

    const envelope = await envelopesApi.getEnvelope(this.accountId, envelopeId);

    return {
      status: envelope.status,
      signedAt: envelope.completedDateTime,
      declinedAt: envelope.declinedDateTime,
      expiredAt: envelope.expiredDateTime,
      signedFileUrl: envelope.documents?.[0]?.uri,
      auditTrailUrl: envelope.certificateUri,
    };
  }

  // Authoritative per-recipient state for the multi-signer webhook
  // handler. Option (b) re-sync: we don't trust the webhook body's
  // shape, we ask DocuSign for the current Recipients structure and
  // map it ourselves. The returned SDK object exposes .signers
  // (Array<Signer>) plus other recipient categories.
  async listRecipients(envelopeId: string): Promise<docusign.Recipients> {
    const apiClient = await this.makeAuthedApiClient();
    const envelopesApi = new docusign.EnvelopesApi(apiClient);
    return envelopesApi.listRecipients(this.accountId, envelopeId);
  }

  // ─── Internals ─────────────────────────────────────────────────────

  // Per-call new ApiClient. The SDK's addDefaultHeader appends rather
  // than replaces; a held client would accumulate stale Authorization
  // headers across mint cycles. Per-call construction is a cheap
  // object init (no network), so the cost is negligible.
  private async makeAuthedApiClient(): Promise<docusign.ApiClient> {
    const token = await this.getAccessToken();
    const client = new docusign.ApiClient();
    client.setBasePath(this.baseUrl);
    client.addDefaultHeader('Authorization', `Bearer ${token}`);
    return client;
  }

  private loadPrivateKey(): Buffer {
    if (this.privateKey !== null) return this.privateKey;
    const resolved = path.resolve(this.keyPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `DocuSign private key file not found at: ${resolved} ` +
        `(DOCUSIGN_PRIVATE_KEY_PATH=${this.keyPath} resolved from cwd=${process.cwd()})`,
      );
    }
    this.privateKey = fs.readFileSync(resolved);
    return this.privateKey;
  }

  private listMissingEnv(): string[] {
    const checks: ReadonlyArray<readonly [string, string]> = [
      ['DOCUSIGN_INTEGRATION_KEY',  this.integrationKey],
      ['DOCUSIGN_USER_ID',          this.userId],
      ['DOCUSIGN_OAUTH_BASE',       this.oauthBase],
      ['DOCUSIGN_PRIVATE_KEY_PATH', this.keyPath],
      ['DOCUSIGN_ACCOUNT_ID',       this.accountId],
      ['DOCUSIGN_BASE_URL',         this.baseUrl],
      ['DOCUSIGN_TEMPLATE_ID',      this.templateId],
    ];
    return checks.filter(([, v]) => !v).map(([name]) => name);
  }

  // Shape the DocuSign SDK's awkwardly-nested error into a readable
  // Error message. consent_required gets a specific hint reminding
  // the operator to run the JWT consent URL once per user/key pair.
  private shapeJwtError(err: DocuSignSdkError): Error {
    const status = err.response?.status;
    const body   = err.response?.body;
    const parts: string[] = [];
    if (status !== undefined) parts.push(`status ${status}`);
    if (body?.error) parts.push(`error: ${body.error}`);
    if (body?.error_description) parts.push(`description: ${body.error_description}`);
    if (body?.message) parts.push(`message: ${body.message}`);
    if (parts.length === 0 && err.message) parts.push(err.message);
    if (body?.error === 'consent_required') {
      parts.push(
        '— the impersonated user has not granted this integration the requested scopes; visit the JWT consent URL, accept, then retry',
      );
    }
    return new Error(`DocuSign JWT request failed: ${parts.join('; ')}`);
  }
}
