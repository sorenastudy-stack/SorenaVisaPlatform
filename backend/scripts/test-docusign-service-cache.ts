/* eslint-disable no-console */
/**
 * PR-DOCUSIGN-1 step 5 — DocuSignService.getAccessToken() cache probe.
 *
 * Boots a Nest application context, gets the DocuSignService singleton
 * from DI, calls getAccessToken() twice in a row, and asserts:
 *
 *   1. mintCount === 1 after the first call          (token was minted)
 *   2. mintCount === 1 after the second call         (cache hit — no
 *                                                     second network call)
 *   3. token1 === token2                              (same string returned)
 *
 * Prints metadata only — token length, mintCount, secondsUntilExpiry.
 * NEVER prints the token itself.
 *
 * Mirrors backend/scripts/test-mail.ts in shape (Nest application
 * context + service retrieval + assertion on observable side effect).
 *
 * Run:    cd backend && npx ts-node scripts/test-docusign-service-cache.ts
 *
 * Exits 0 on success, 1 on any assertion failure or service error.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { DocuSignService } from '../src/contracts/docusign.service';

async function main(): Promise<void> {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('DocuSignService.getAccessToken() — mint + cache probe');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  // Keep boot noise low; only surface real problems.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  let exitCode = 0;
  try {
    const service = app.get(DocuSignService);

    console.log(`pre-call mintCount: ${service.mintCount} (expect 0)`);
    console.log('');

    console.log('— call 1: getAccessToken() (expect mint via JWT grant) —');
    const t0 = Date.now();
    const token1 = await service.getAccessToken();
    const elapsed1 = Date.now() - t0;
    const mint1 = service.mintCount;
    const ttl1 = service.secondsUntilExpiry;
    console.log(`  token length:        ${token1.length} chars (NOT printed)`);
    console.log(`  mintCount:           ${mint1}`);
    console.log(`  secondsUntilExpiry:  ${ttl1}`);
    console.log(`  call time:           ${elapsed1} ms`);
    console.log('');

    console.log('— call 2: getAccessToken() (expect cache hit, no network) —');
    const t1 = Date.now();
    const token2 = await service.getAccessToken();
    const elapsed2 = Date.now() - t1;
    const mint2 = service.mintCount;
    const ttl2 = service.secondsUntilExpiry;
    console.log(`  token length:        ${token2.length} chars (NOT printed)`);
    console.log(`  mintCount:           ${mint2}`);
    console.log(`  secondsUntilExpiry:  ${ttl2}`);
    console.log(`  call time:           ${elapsed2} ms`);
    console.log('');

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('Assertions');
    console.log('═══════════════════════════════════════════════════════════════');

    const a1 = mint1 === 1;
    const a2 = mint2 === 1;
    const a3 = token1 === token2;

    console.log(`  [${a1 ? 'OK' : 'FAIL'}] mintCount after first call  === 1   (got ${mint1})`);
    console.log(`  [${a2 ? 'OK' : 'FAIL'}] mintCount after second call === 1   (got ${mint2})`);
    console.log(`  [${a3 ? 'OK' : 'FAIL'}] token1 === token2  (cache hit, identical string)`);
    console.log('');

    if (a1 && a2 && a3) {
      console.log('[PASS] DocuSignService mints once, caches, returns identical token on re-call.');
    } else {
      console.log('[FAIL] Cache behaviour did not match expectations.');
      exitCode = 1;
    }
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
  } catch (err) {
    console.error('');
    console.error('[FAIL] Probe errored:');
    console.error(err instanceof Error ? err.message : err);
    exitCode = 1;
  } finally {
    await app.close();
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[FAIL] Unhandled exception in test-docusign-service-cache.ts:');
  console.error(err);
  process.exit(1);
});
