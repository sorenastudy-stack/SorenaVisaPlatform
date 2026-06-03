/**
 * PR-DOCUSIGN-1 step 4 — JWT-grant connection probe.
 *
 * Standalone script (no NestJS, no imports from src/). Mints a JWT
 * access token against the DocuSign OAuth endpoint and prints whether
 * it succeeded plus token metadata. NEVER prints the access token
 * itself — only its length, the returned scope, and the expires_in.
 *
 * Mirrors the precedent set by scripts/test-mail.ts: "can we hit the
 * third-party API at all?" probe, runnable repeatedly while iterating
 * on the .env values without touching the running backend.
 *
 * Required env vars (all four — script lists the missing one on
 * failure):
 *   DOCUSIGN_INTEGRATION_KEY    OAuth client ID (UI label "Integration Key")
 *   DOCUSIGN_USER_ID            Impersonated user GUID
 *   DOCUSIGN_OAUTH_BASE         e.g. account-d.docusign.com (no https://)
 *   DOCUSIGN_PRIVATE_KEY_PATH   relative path from backend/ to the RSA key file
 *
 * Run:    cd backend && npx ts-node scripts/test-docusign-jwt.ts
 *
 * Exits 0 on success, 1 on any failure (missing env, missing key file,
 * DocuSign API error). Errors are categorised: consent_required gets a
 * specific reminder; other DocuSign errors print their body.message.
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as docusign from 'docusign-esign';

interface JwtResultBody {
  access_token?: string;
  expires_in?: number;
  scope?:      string;
  token_type?: string;
}

interface DocuSignErrorShape {
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

function readEnvOrDie(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    console.error(`[FAIL] Missing required env var: ${name}`);
    process.exit(1);
  }
  return v.trim();
}

async function main(): Promise<void> {
  console.log('[test-docusign-jwt] starting…');

  // 1. Env validation. Report ALL missing names rather than failing on
  //    the first one — saves a back-and-forth.
  const REQUIRED = [
    'DOCUSIGN_INTEGRATION_KEY',
    'DOCUSIGN_USER_ID',
    'DOCUSIGN_OAUTH_BASE',
    'DOCUSIGN_PRIVATE_KEY_PATH',
  ];
  const missing = REQUIRED.filter((k) => !process.env[k] || process.env[k]!.trim() === '');
  if (missing.length > 0) {
    console.error(`[FAIL] Missing required env vars: ${missing.join(', ')}`);
    console.error('       Fill these in backend/.env and re-run.');
    process.exit(1);
  }

  const integrationKey = readEnvOrDie('DOCUSIGN_INTEGRATION_KEY');
  const userId         = readEnvOrDie('DOCUSIGN_USER_ID');
  const oauthBase      = readEnvOrDie('DOCUSIGN_OAUTH_BASE');
  const keyPathRaw     = readEnvOrDie('DOCUSIGN_PRIVATE_KEY_PATH');

  // 2. Key-file load. Resolve relative to the script's cwd — typically
  //    backend/ when run via `cd backend && npx ts-node scripts/...`.
  const keyPath = path.resolve(keyPathRaw);
  if (!fs.existsSync(keyPath)) {
    console.error(`[FAIL] Private key file not found at: ${keyPath}`);
    console.error(`       (DOCUSIGN_PRIVATE_KEY_PATH=${keyPathRaw} resolved from cwd=${process.cwd()})`);
    process.exit(1);
  }
  const privateKey = fs.readFileSync(keyPath);
  console.log(`[ok] Loaded private key from ${keyPath} (${privateKey.length} bytes)`);

  // 3. Configure the SDK. setOAuthBasePath expects the host (no scheme).
  const apiClient = new docusign.ApiClient();
  apiClient.setOAuthBasePath(oauthBase);
  console.log(`[ok] OAuth base: ${oauthBase}`);
  console.log(`[ok] Integration key: ${integrationKey.slice(0, 8)}… (8 of ${integrationKey.length} chars)`);
  console.log(`[ok] Impersonated user: ${userId.slice(0, 8)}… (8 of ${userId.length} chars)`);

  // 4. Request a JWT user token. Scopes per the PR-DOCUSIGN-1 plan:
  //    signature (envelope ops) + impersonation (act-as user).
  const SCOPES = ['signature', 'impersonation'];
  const TOKEN_LIFETIME_SECONDS = 3600; // SDK max for JWT user token

  let result: { body: JwtResultBody };
  try {
    result = await apiClient.requestJWTUserToken(
      integrationKey,
      userId,
      SCOPES,
      privateKey,
      TOKEN_LIFETIME_SECONDS,
    );
  } catch (err) {
    handleDocuSignError(err as DocuSignErrorShape);
    process.exit(1);
  }

  // 5. Success — surface metadata, NEVER the token itself.
  const body = result.body ?? {};
  const tokenLength = body.access_token ? body.access_token.length : 0;
  console.log('');
  console.log('[OK] JWT auth succeeded.');
  console.log(`     access_token length: ${tokenLength} chars (NOT printed)`);
  console.log(`     expires_in:          ${body.expires_in ?? '?'} seconds`);
  console.log(`     token_type:          ${body.token_type ?? '?'}`);
  console.log(`     scope returned:      ${body.scope ?? '(none in body)'}`);
  process.exit(0);
}

function handleDocuSignError(err: DocuSignErrorShape): void {
  console.error('');
  console.error('[FAIL] DocuSign JWT request errored.');

  const status = err.response?.status;
  const body   = err.response?.body;
  const text   = err.response?.text;

  if (status !== undefined) console.error(`       HTTP status: ${status}`);

  if (body) {
    if (body.error)             console.error(`       error:             ${body.error}`);
    if (body.error_description) console.error(`       error_description: ${body.error_description}`);
    if (body.message)           console.error(`       message:           ${body.message}`);

    // Specific hint for the most common JWT-grant first-run failure.
    if (body.error === 'consent_required') {
      console.error('');
      console.error('       → consent_required means the impersonated user has not granted');
      console.error('         this integration the signature + impersonation scopes yet. In the');
      console.error('         DocuSign demo admin, follow the JWT consent URL for the integration');
      console.error('         key and impersonated user, sign in, click Accept, then re-run.');
    }
  } else if (text) {
    console.error(`       body (text): ${text}`);
  } else if (err.message) {
    console.error(`       message: ${err.message}`);
  } else {
    console.error('       (no body / message on the error object)');
    console.error(err);
  }
}

main().catch((err) => {
  console.error('[FAIL] Unhandled exception in test-docusign-jwt.ts:');
  console.error(err);
  process.exit(1);
});
