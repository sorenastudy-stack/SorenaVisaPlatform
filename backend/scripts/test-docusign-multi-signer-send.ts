/* eslint-disable no-console */
/**
 * PR-DOCUSIGN-1 step 5 piece 4 — manual multi-signer envelope send probe.
 *
 * Real network call to DocuSign DEMO. Sends a real 3-signer envelope
 * to the three email addresses you provide as flags. All three
 * addresses will receive signing-invitation emails (signer 1
 * immediately; signers 2 and 3 sequentially as each one completes).
 *
 * createEnvelope vs createContract — chose DIRECT createEnvelope:
 *   - createContract requires a real Case + Lead + Contact in the
 *     dev DB and writes Contract + 3 ContractSigner rows on success.
 *     For a "does the send work?" probe that's extra moving parts
 *     and DB-cleanup hygiene.
 *   - The createContract → DB persistence path is already covered
 *     by contracts.service.spec.ts (real DB + mocked SDK).
 *   - The envelope shape is already covered by docusign.service.spec.ts
 *     (pure buildEnvelopeDefinition assertions).
 *   - This probe completes the trio: confirms DocuSign's API
 *     actually accepts what buildEnvelopeDefinition produces,
 *     dispatches emails, and returns a real envelopeId.
 *   - Read-only on the DB: zero rows written, zero cleanup needed.
 *
 * Bare run with no args prints usage and exits 1 without sending.
 *
 * Run:
 *   cd backend && npx ts-node scripts/test-docusign-multi-signer-send.ts \
 *     --client-email <email>  --client-name "<name>" \
 *     --lia-email <email>     --lia-name "<name>" \
 *     [--director-email <email>] [--director-name "<name>"] \
 *     [--lia-iaa "<iaa licence number>"]
 *
 * Director defaults to CONTRACT_DIRECTOR_EMAIL / CONTRACT_DIRECTOR_NAME
 * from backend/.env if --director-email / --director-name are omitted.
 * --lia-iaa defaults to a synthetic test value so the LIA's IAA tabs
 * still populate during calibration.
 *
 * Exits 0 on successful dispatch, 1 on missing args / engagement-letter
 * PDF missing / DocuSign API error.
 */

import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

import { AppModule } from '../src/app.module';
import {
  DocuSignService,
  EnvelopeDocumentSpec,
  EnvelopeRecipientSpec,
  TEMPLATE_ROLE_CLIENT,
  TEMPLATE_ROLE_LIA,
  TEMPLATE_ROLE_DIRECTOR,
} from '../src/contracts/docusign.service';
import { stampLiaIdentity } from '../src/contracts/engagement-letter-stamp';

// PR-DOCUSIGN-1 step 5 piece 5e — point the probe at the REAL
// engagement letter (matches what createContract reads in the
// production code path), so visual calibration of the 5b anchored
// tabs happens against the document signers will actually receive.
const ENGAGEMENT_LETTER_PDF_REL_PATH =
  'assets/contract-templates/engagement-letter-v1.pdf';

// Default IAA licence number when --lia-iaa is omitted. Lets every
// calibration send populate the LIA's IAA tabs even when the operator
// doesn't pass a real number — surfaces tab placement immediately.
const DEFAULT_LIA_IAA_FOR_PROBE = '202300520';

// ─── Minimal CLI flag parser (no extra deps) ───────────────────────────────

function getFlag(name: string): string | undefined {
  const flag = `--${name}`;
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === flag && i + 1 < process.argv.length) return process.argv[i + 1];
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return undefined;
}

function printUsageAndExit(reason?: string): never {
  if (reason) console.error(`[FAIL] ${reason}`);
  console.error('');
  console.error('Usage:');
  console.error('  cd backend && npx ts-node scripts/test-docusign-multi-signer-send.ts \\');
  console.error('    --client-email <email>  --client-name "<name>" \\');
  console.error('    --lia-email <email>     --lia-name "<name>" \\');
  console.error('   [--director-email <email>] [--director-name "<name>"] \\');
  console.error('   [--lia-iaa "<iaa licence number>"]');
  console.error('');
  console.error('Director defaults to CONTRACT_DIRECTOR_EMAIL / CONTRACT_DIRECTOR_NAME');
  console.error('from backend/.env if --director-email / --director-name are omitted.');
  console.error(`--lia-iaa defaults to ${DEFAULT_LIA_IAA_FOR_PROBE} if omitted (synthetic test value).`);
  console.error('');
  console.error('Both --flag value and --flag=value styles are accepted.');
  console.error('');
  console.error('This sends a REAL 3-signer envelope to DocuSign DEMO. All three');
  console.error('addresses will receive signing emails — use addresses you control.');
  process.exit(1);
}

// ─── Error printer ─────────────────────────────────────────────────────────
//
// DocuSign SDK errors are awkwardly shaped — the useful operator info
// lives in different places depending on whether the SDK pre-parsed
// the response body. This helper dumps every signal we can find:
//
//   • err.message                                  (SDK-side summary)
//   • err.status / err.statusCode                  (top-level if any)
//   • err.response.status / statusText             (HTTP)
//   • err.response.headers['content-type']         (sanity check)
//   • err.response.body  (parsed JSON, full depth) (the real errorCode + message live here)
//   • err.response.text                            (raw body string — fallback if body isn't parsed)
//   • err.response.error.message                   (superagent's own error)
//   • full err object dump (util.inspect, depth=8) (absolute fallback)
//
// All access is guarded so the printer NEVER throws — even partial
// signal is more useful than nothing when an envelope send fails.

function safeInspect(value: unknown, depth = 8): string {
  try {
    return util.inspect(value, { depth, colors: false, maxArrayLength: 200, maxStringLength: 8000 });
  } catch (e) {
    return `<inspect failed: ${e instanceof Error ? e.message : String(e)}>`;
  }
}

function printDocuSignError(err: unknown): void {
  const e = err as any;

  // 1. SDK-side error message (always present on Error instances).
  if (e?.message) {
    console.error('');
    console.error('err.message:');
    console.error(`  ${e.message}`);
  }

  // 2. Top-level status if surfaced directly.
  if (e?.status !== undefined)     console.error(`err.status:       ${e.status}`);
  if (e?.statusCode !== undefined) console.error(`err.statusCode:   ${e.statusCode}`);

  // 3. Response object (superagent-style).
  const res = e?.response;
  if (res) {
    console.error('');
    console.error('err.response:');
    if (res.status !== undefined)     console.error(`  status:       ${res.status}`);
    if (res.statusCode !== undefined) console.error(`  statusCode:   ${res.statusCode}`);
    if (res.statusText)               console.error(`  statusText:   ${res.statusText}`);

    const contentType = res.headers?.['content-type'] ?? res.header?.['content-type'];
    if (contentType) console.error(`  content-type: ${contentType}`);

    // 3a. Parsed body — where DocuSign's errorCode + message live.
    if (res.body !== undefined && res.body !== null) {
      console.error('');
      console.error('err.response.body  (parsed — this is where DocuSign puts errorCode + message):');
      console.error(safeInspect(res.body));
    }

    // 3b. Raw response text — if body isn't parsed, useful info lives here.
    if (typeof res.text === 'string' && res.text.length > 0) {
      console.error('');
      console.error('err.response.text  (raw body):');
      console.error(res.text);
    }

    // 3c. Superagent's own .error sub-object.
    if (res.error && (res.error.message || res.error.status)) {
      console.error('');
      console.error('err.response.error:');
      console.error(safeInspect(res.error));
    }
  }

  // 4. Full dump as absolute fallback — covers any field we didn't
  //    explicitly look at above. Filter out the huge `request` blob
  //    that superagent attaches (it's the OUTBOUND request, not the
  //    response) to keep the dump readable.
  console.error('');
  console.error('err  (full object dump, depth=8 — final fallback):');
  const stripped = (() => {
    if (!e || typeof e !== 'object') return e;
    const { request, _events, _eventsCount, ...rest } = e as any;
    return rest;
  })();
  console.error(safeInspect(stripped));
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Multi-signer envelope send probe — DocuSign DEMO');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  // 1. Args.
  const clientEmail   = getFlag('client-email');
  const clientName    = getFlag('client-name');
  const liaEmail      = getFlag('lia-email');
  const liaName       = getFlag('lia-name');
  const directorEmail = getFlag('director-email') ?? process.env.CONTRACT_DIRECTOR_EMAIL;
  const directorName  = getFlag('director-name')  ?? process.env.CONTRACT_DIRECTOR_NAME;
  // 5e — feeds EnvelopeRecipientSpec.prefill.iaaLicenceNumber on the
  // LIA spec so the IAA Licence Number tabs (Clause 2.1 + page-11
  // block) populate during calibration. Default keeps the visible-
  // calibration behaviour even when --lia-iaa is omitted.
  const liaIaa        = getFlag('lia-iaa') ?? DEFAULT_LIA_IAA_FOR_PROBE;

  const missing: string[] = [];
  if (!clientEmail)   missing.push('--client-email');
  if (!clientName)    missing.push('--client-name');
  if (!liaEmail)      missing.push('--lia-email');
  if (!liaName)       missing.push('--lia-name');
  if (!directorEmail) missing.push('--director-email (or CONTRACT_DIRECTOR_EMAIL in .env)');
  if (!directorName)  missing.push('--director-name (or CONTRACT_DIRECTOR_NAME in .env)');
  if (missing.length > 0) {
    printUsageAndExit(`Missing required args: ${missing.join(', ')}`);
  }

  console.log('Signers (3 total, sequential routing — emailed in order):');
  console.log(`  1. CLIENT    ${clientEmail}    [${clientName}]`);
  console.log(`  2. LIA       ${liaEmail}    [${liaName}]   IAA: ${liaIaa}`);
  console.log(`  3. DIRECTOR  ${directorEmail}    [${directorName}]`);
  console.log('');

  // 2. Engagement letter PDF (matches createContract's source).
  const pdfPath = path.resolve(ENGAGEMENT_LETTER_PDF_REL_PATH);
  if (!fs.existsSync(pdfPath)) {
    console.error(`[FAIL] Engagement-letter PDF not found at: ${pdfPath}`);
    console.error(`       (cwd: ${process.cwd()})`);
    process.exit(1);
  }
  const pdfBytes = fs.readFileSync(pdfPath);
  console.log(`Document: ${pdfPath}`);
  console.log(`          (${pdfBytes.length} bytes — pre-stamp)`);

  // 2b. Stamp the LIA's identity into the PDF before the envelope
  //     is built. After 5g the LIA name + IAA number live in the
  //     document's static layer at both Clause 2.1 (page 1) and the
  //     page-11 LIA signature block — matching what createContract
  //     does in production.
  const stampedPdfBytes = await stampLiaIdentity(pdfBytes, {
    liaName:          liaName!,
    iaaLicenceNumber: liaIaa,
  });
  console.log(`          (${stampedPdfBytes.length} bytes — post-stamp)`);
  console.log(`Stamp: liaName=${liaName!} | iaaLicenceNumber=${liaIaa}`);
  console.log('');

  // 3. Build specs.
  const documents: EnvelopeDocumentSpec[] = [{
    documentId:    '1',
    name:          'Engagement letter.pdf',
    fileExtension: 'pdf',
    bytes:         stampedPdfBytes,
  }];
  const signers: EnvelopeRecipientSpec[] = [
    {
      recipientId:  '1',
      routingOrder: 1,
      templateRole: TEMPLATE_ROLE_CLIENT,
      email:        clientEmail!,
      name:         clientName!,
    },
    {
      recipientId:  '2',
      routingOrder: 2,
      templateRole: TEMPLATE_ROLE_LIA,
      email:        liaEmail!,
      name:         liaName!,
      // Per 5g — LIA name + IAA number are stamped into the PDF
      // before this point via stampLiaIdentity() above. Per 5h — all
      // other interactive fields live in the DocuSign template now.
    },
    {
      recipientId:  '3',
      routingOrder: 3,
      templateRole: TEMPLATE_ROLE_DIRECTOR,
      email:        directorEmail!,
      name:         directorName!,
    },
  ];

  // 4. Boot Nest, get the service, dispatch.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  let exitCode = 0;
  try {
    const docuSign = app.get(DocuSignService);

    console.log('— sending envelope via DocuSignService.createEnvelope —');
    const probeCaseId = `probe-${Date.now()}`;
    const envelopeId = await docuSign.createEnvelope(documents, signers, {
      emailSubject: 'Sorena Visa engagement letter — signature required (DocuSign DEMO probe)',
      emailBlurb:
        'PR-DOCUSIGN-1 step 5 piece 4 probe. Please ignore unless you are expecting this test envelope. ' +
        'The next signer is emailed automatically once you complete your signature.',
      caseId: probeCaseId,
    });

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('[OK] Envelope dispatched.');
    console.log(`     envelopeId:    ${envelopeId}`);
    console.log(`     probeCaseId:   ${probeCaseId}  (used only in the service log line; no DB row written)`);
    console.log('');
    console.log('Signing-invitation emails — sequential routing:');
    console.log(`  → ${clientEmail}`);
    console.log(`      role:    CLIENT (signer #1, routingOrder 1)`);
    console.log(`      status:  emailed IMMEDIATELY by DocuSign`);
    console.log(`  → ${liaEmail}`);
    console.log(`      role:    LIA (signer #2, routingOrder 2)`);
    console.log(`      status:  queued; emailed after signer #1 completes`);
    console.log(`  → ${directorEmail}`);
    console.log(`      role:    DIRECTOR (signer #3, routingOrder 3)`);
    console.log(`      status:  queued; emailed after signer #2 completes`);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log('To inspect the envelope and routing in the DocuSign demo UI,');
    console.log('log in to https://appdemo.docusign.com and search for envelope');
    console.log(`id ${envelopeId}.`);
    console.log('');
  } catch (err) {
    exitCode = 1;
    console.error('');
    console.error('═══════════════════════════════════════════════════════════════');
    console.error('[FAIL] Envelope dispatch errored — full DocuSign response below');
    console.error('═══════════════════════════════════════════════════════════════');
    printDocuSignError(err);
    console.error('═══════════════════════════════════════════════════════════════');
  } finally {
    await app.close();
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[FAIL] Unhandled exception in test-docusign-multi-signer-send.ts:');
  console.error(err);
  process.exit(1);
});
