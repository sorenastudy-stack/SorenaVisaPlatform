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
// The three public methods (createEnvelope, getSigningUrl, syncStatus)
// have unchanged signatures and unchanged envelope-building bodies.
// They differ from the previous static-bearer implementation in only
// the apiClient acquisition: a fresh authed instance per call via
// makeAuthedApiClient(). The per-call ApiClient pattern mirrors the
// proven probe at scripts/test-docusign-jwt.ts and avoids the SDK's
// addDefaultHeader-appends-not-replaces quirk that would accumulate
// stale Authorization headers on a held client.
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

  // D3 — lazy-loaded on first getAccessToken() call. Held as Buffer
  // once read; keeps the app boot resilient to a missing key file.
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

    const missing = this.listMissingEnv();
    if (missing.length > 0) {
      this.logger.warn(
        `DocuSign auth env vars missing — contract signing will be unavailable: ${missing.join(', ')}`,
      );
    }
  }

  // D5 — public readonly getter, used by the cache probe. Stays at 1
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

  // D6 — public so the probe can call it directly. Production callers
  // don't need this; they go through createEnvelope / getSigningUrl /
  // syncStatus which all use makeAuthedApiClient() internally.
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

  // ─── Existing public methods (signatures + bodies preserved) ──────
  //
  // Only the apiClient acquisition changed (fresh authed instance per
  // call). Everything below that one swap is byte-identical to the
  // pre-rewrite implementation — envelope assembly, recipient setup,
  // SignHere tab positions, response shaping. The multi-signer
  // envelope rewrite is a later step.

  async createEnvelope(
    caseId: string,
    signerEmail: string,
    signerName: string,
  ): Promise<string> {
    const apiClient = await this.makeAuthedApiClient();
    const envelopesApi = new docusign.EnvelopesApi(apiClient);

    const envelopeDefinition = new docusign.EnvelopeDefinition();
    envelopeDefinition.emailSubject = 'Please sign this contract';
    envelopeDefinition.emailBlurb = 'Please review and sign the attached contract.';
    envelopeDefinition.status = 'sent';

    // Add document (placeholder - in real implementation, you'd upload actual contract)
    const document = new docusign.Document();
    document.documentBase64 = Buffer.from('Contract content here').toString('base64');
    document.name = 'Contract.pdf';
    document.fileExtension = 'pdf';
    document.documentId = '1';
    envelopeDefinition.documents = [document];

    // Add signer
    const signer = new docusign.Signer();
    signer.email = signerEmail;
    signer.name = signerName;
    signer.recipientId = '1';
    signer.routingOrder = '1';

    // Add sign here tab
    const signHere = new docusign.SignHere();
    signHere.documentId = '1';
    signHere.pageNumber = '1';
    signHere.recipientId = '1';
    signHere.tabLabel = 'SignHereTab';
    signHere.xPosition = '100';
    signHere.yPosition = '150';

    signer.tabs = new docusign.Tabs();
    signer.tabs.signHereTabs = [signHere];

    const recipients = new docusign.Recipients();
    recipients.signers = [signer];
    envelopeDefinition.recipients = recipients;

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

  // ─── Internals ─────────────────────────────────────────────────────

  // D1 — per-call new ApiClient. The SDK's addDefaultHeader appends
  // rather than replaces; a held client would accumulate stale
  // Authorization headers across mint cycles. Per-call construction
  // is a cheap object init (no network), so the cost is negligible.
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
