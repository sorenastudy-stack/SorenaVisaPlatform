/**
 * PR-DOCUSIGN-1 step 3 (C3) — LiaProfilesService security spec.
 *
 * Mirrors the PR-LIA-AUTO-ASSIGN Phase-7 pattern: real PrismaClient,
 * per-test seed + cleanup. Targets the SERVICE methods directly (not
 * the HTTP layer) because the architectural cross-tenant guarantee
 * lives at the service+controller boundary:
 *
 *   • The LIA-self-service controller has NO `userId` route parameter
 *     on any of its 4 routes — userId is always sourced from
 *     `req.user.userId`. There is no path to attack.
 *   • The verifier controller takes `:userId` as a path param but is
 *     class-gated to OWNER/ADMIN/SUPER_ADMIN and applies a service-
 *     layer self-guard for the mutating routes (E7/E8).
 *
 * The 6 tests in this file probe the service-layer contracts that
 * back those guarantees: userId-scoping, file-bytes landing in the
 * right bucket, verification reset on credential change, the
 * verify/reject happy paths, the self-verify/self-reject guard, and
 * the "reject leaves the row intact" rule from design decision D3.
 *
 * Each test seeds its own users + profiles with a per-run stamp so
 * parallel jest workers don't collide on email-unique constraints.
 * Test-written files land under ./uploads/lia-licences/<userId>/ and
 * are cleaned up explicitly after each test that creates them.
 */

import { PrismaClient } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { LiaProfilesService } from './lia-profiles.service';
import { PrismaService } from '../../prisma/prisma.service';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
const PENDING_DIR = path.join(UPLOAD_DIR, 'pending');
const LIA_LICENCE_DIR = path.join(UPLOAD_DIR, 'lia-licences');
const TAG = '__pr_docusign_1_step3__';

// ─── Seed / cleanup helpers ────────────────────────────────────────────────

interface SeededLia {
  userId: string;
  profileId: string;     // populated after first findOrCreate-driven write
  stamp: string;
}

async function seedLia(
  prisma: PrismaClient,
  opts?: { withProfile?: 'verified' | 'pending' | null },
): Promise<SeededLia> {
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const user = await prisma.user.create({
    data: {
      name:         `Test LIA ${stamp}`,
      email:        `lia.${stamp}@${TAG}.test`,
      passwordHash: 'no-login',
      role:         'LIA',
      isActive:     true,
    },
  });

  let profileId = '';
  if (opts?.withProfile === 'verified') {
    const p = await prisma.liaProfile.create({
      data: {
        userId:                 user.id,
        iaaLicenceNumber:       '123456',
        iaaLicenceFileUrl:      `/fake/${stamp}.pdf`,
        iaaLicenceFileName:     'fake.pdf',
        iaaLicenceFileMime:     'application/pdf',
        iaaLicenceSizeBytes:    1234,
        // Verifier is the same user — schema permits this; the
        // self-guard lives in the service, not at the DB level.
        iaaLicenceVerifiedAt:   new Date(),
        iaaLicenceVerifiedById: user.id,
      },
    });
    profileId = p.id;
  } else if (opts?.withProfile === 'pending') {
    const p = await prisma.liaProfile.create({
      data: {
        userId:              user.id,
        iaaLicenceNumber:    '654321',
        iaaLicenceFileUrl:   `/fake/${stamp}.pdf`,
        iaaLicenceFileName:  'fake.pdf',
        iaaLicenceFileMime:  'application/pdf',
        iaaLicenceSizeBytes: 5678,
      },
    });
    profileId = p.id;
  }

  return { userId: user.id, profileId, stamp };
}

async function cleanupLia(prisma: PrismaClient, lia: SeededLia) {
  // Audit rows about the profile (entityId points at the profile row)
  if (lia.profileId) {
    await prisma.auditLog.deleteMany({
      where: { entityType: 'LIA_PROFILE', entityId: lia.profileId },
    });
  } else {
    // Profile may have been lazy-created mid-test; sweep by userId
    const p = await prisma.liaProfile.findUnique({ where: { userId: lia.userId } });
    if (p) {
      await prisma.auditLog.deleteMany({
        where: { entityType: 'LIA_PROFILE', entityId: p.id },
      });
    }
  }
  // Audit rows where this user is the actor (verify/reject events on
  // OTHER profiles too — needed when this user is a verifier in a test).
  await prisma.auditLog.deleteMany({ where: { userId: lia.userId } });
  // LiaProfile is Cascade-on-user-delete (Step 1 migration), but
  // delete explicitly so the test is robust against future schema
  // changes that flip the FK to RESTRICT.
  await prisma.liaProfile.deleteMany({ where: { userId: lia.userId } });
  // Best-effort wipe of any uploaded files for this user.
  const userDir = path.join(LIA_LICENCE_DIR, lia.userId);
  try {
    await fs.promises.rm(userDir, { recursive: true, force: true });
  } catch { /* ignore — directory may not exist */ }
  await prisma.user.delete({ where: { id: lia.userId } });
}

// Construct a real on-disk file in PENDING_DIR and return a synthetic
// Multer file descriptor pointing at it. Mirrors the shape Multer
// hands the controller after disk-storage diskStorage().
async function makePendingPdf(
  stamp: string,
  size = 2048,
): Promise<Express.Multer.File> {
  await fs.promises.mkdir(PENDING_DIR, { recursive: true });
  const basename = `${Date.now()}-${Math.round(Math.random() * 1e9)}.pdf`;
  const fullPath = path.join(PENDING_DIR, basename);
  const buf = Buffer.alloc(size, 0x42);  // arbitrary content; never read
  await fs.promises.writeFile(fullPath, buf);
  return {
    fieldname:    'file',
    originalname: `licence-${stamp}.pdf`,
    encoding:     '7bit',
    mimetype:     'application/pdf',
    size,
    destination:  PENDING_DIR,
    filename:     basename,
    path:         fullPath,
    buffer:       buf,
    stream:       undefined as never,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('LiaProfilesService (PR-DOCUSIGN-1 step 3 — C3)', () => {
  let prisma: PrismaClient;
  let service: LiaProfilesService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    service = new LiaProfilesService(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ─── Test 1 — Cross-tenant guard (service-layer scoping) ───────────────

  describe('test 1: service methods scope to the passed userId', () => {
    let liaA: SeededLia;
    let liaB: SeededLia;
    beforeEach(async () => {
      liaA = await seedLia(prisma);
      liaB = await seedLia(prisma);
    });
    afterEach(async () => {
      await cleanupLia(prisma, liaA);
      await cleanupLia(prisma, liaB);
    });

    it('updateOwnLicenceNumber(A, ...) only mutates A; B is untouched', async () => {
      const actorA = { id: liaA.userId, name: 'A', role: 'LIA' };
      await service.updateOwnLicenceNumber(
        liaA.userId,
        { iaaLicenceNumber: '111222' },
        actorA,
      );

      const a = await prisma.liaProfile.findUnique({ where: { userId: liaA.userId } });
      const b = await prisma.liaProfile.findUnique({ where: { userId: liaB.userId } });

      expect(a?.iaaLicenceNumber).toBe('111222');
      // B's row is null (lazy-create only runs on getOwnProfile /
      // findOrCreateOwn; B was never touched).
      expect(b).toBeNull();
    });

    it('getOwnProfile(A) lazy-creates A only; B remains absent', async () => {
      const resp = await service.getOwnProfile(liaA.userId);
      expect(resp.userId).toBe(liaA.userId);
      expect(resp.verificationState).toBe('PENDING');

      const b = await prisma.liaProfile.findUnique({ where: { userId: liaB.userId } });
      expect(b).toBeNull();
    });
  });

  // ─── Test 2 — Upload lands correctly ───────────────────────────────────

  describe('test 2: licence upload writes to lia-licences/<userId>/ + columns + audit', () => {
    let lia: SeededLia;
    beforeEach(async () => { lia = await seedLia(prisma); });
    afterEach(async () => { await cleanupLia(prisma, lia); });

    it('file lands under lia-licences/<userId>/, 4 columns set, LIA_LICENCE_UPLOADED row written', async () => {
      const file = await makePendingPdf(lia.stamp, 4096);
      const actor = { id: lia.userId, name: 'A', role: 'LIA' };

      const result = await service.uploadOwnLicenceFile(lia.userId, file, actor);

      expect(result.ok).toBe(true);
      expect(result.fileName).toBe(`licence-${lia.stamp}.pdf`);
      expect(result.sizeBytes).toBe(4096);
      expect(result.mime).toBe('application/pdf');
      expect(result.replacedPrior).toBe(false);

      // 4 file-metadata columns set on the row
      const row = await prisma.liaProfile.findUnique({ where: { userId: lia.userId } });
      expect(row).not.toBeNull();
      expect(row!.iaaLicenceFileName).toBe(`licence-${lia.stamp}.pdf`);
      expect(row!.iaaLicenceFileMime).toBe('application/pdf');
      expect(row!.iaaLicenceSizeBytes).toBe(4096);
      expect(row!.iaaLicenceFileUrl).toMatch(
        // Cross-platform: backslash on Windows, forward slash on Linux.
        new RegExp(`lia-licences[\\\\/]${lia.userId}[\\\\/].*\\.pdf$`),
      );

      // The renamed file actually exists on disk
      expect(fs.existsSync(row!.iaaLicenceFileUrl!)).toBe(true);

      // The original pending file is gone
      expect(fs.existsSync(file.path)).toBe(false);

      // Audit row written
      const audit = await prisma.auditLog.findMany({
        where: {
          entityType: 'LIA_PROFILE',
          entityId: row!.id,
          eventType: 'LIA_LICENCE_UPLOADED',
        },
      });
      expect(audit).toHaveLength(1);
      const nv = audit[0]!.newValue as Record<string, unknown>;
      expect(nv.fileName).toBe(`licence-${lia.stamp}.pdf`);
      expect(nv.sizeBytes).toBe(4096);
      expect(nv.mime).toBe('application/pdf');
      expect(nv.replacedPrior).toBe(false);
      expect(nv.resetsVerification).toBe(false);

      // Stamp profileId on the fixture so afterEach finds the audit rows
      lia.profileId = row!.id;
    });
  });

  // ─── Test 3 — Verification reset on credential change ──────────────────

  describe('test 3a: changing licence number on a verified profile clears verifiedAt + verifiedById', () => {
    let lia: SeededLia;
    beforeEach(async () => { lia = await seedLia(prisma, { withProfile: 'verified' }); });
    afterEach(async () => { await cleanupLia(prisma, lia); });

    it('updateOwnLicenceNumber clears the two verify columns and reports resetsVerification=true', async () => {
      const before = await prisma.liaProfile.findUnique({ where: { userId: lia.userId } });
      expect(before?.iaaLicenceVerifiedAt).not.toBeNull();
      expect(before?.iaaLicenceVerifiedById).toBe(lia.userId);

      const actor = { id: lia.userId, name: 'A', role: 'LIA' };
      const result = await service.updateOwnLicenceNumber(
        lia.userId,
        { iaaLicenceNumber: '999888' },
        actor,
      );
      expect(result.changed).toBe(true);
      expect(result.resetsVerification).toBe(true);

      const after = await prisma.liaProfile.findUnique({ where: { userId: lia.userId } });
      expect(after?.iaaLicenceNumber).toBe('999888');
      expect(after?.iaaLicenceVerifiedAt).toBeNull();
      expect(after?.iaaLicenceVerifiedById).toBeNull();
    });
  });

  describe('test 3b: re-uploading the licence file on a verified profile clears verifiedAt + verifiedById', () => {
    let lia: SeededLia;
    beforeEach(async () => { lia = await seedLia(prisma, { withProfile: 'verified' }); });
    afterEach(async () => { await cleanupLia(prisma, lia); });

    it('uploadOwnLicenceFile clears the two verify columns and reports resetsVerification=true', async () => {
      const before = await prisma.liaProfile.findUnique({ where: { userId: lia.userId } });
      expect(before?.iaaLicenceVerifiedAt).not.toBeNull();

      const file = await makePendingPdf(lia.stamp);
      const actor = { id: lia.userId, name: 'A', role: 'LIA' };
      const result = await service.uploadOwnLicenceFile(lia.userId, file, actor);
      expect(result.resetsVerification).toBe(true);
      expect(result.replacedPrior).toBe(true);

      const after = await prisma.liaProfile.findUnique({ where: { userId: lia.userId } });
      expect(after?.iaaLicenceVerifiedAt).toBeNull();
      expect(after?.iaaLicenceVerifiedById).toBeNull();
      // File metadata replaced with the new upload
      expect(after?.iaaLicenceFileName).toBe(`licence-${lia.stamp}.pdf`);
    });
  });

  // ─── Test 4 — Verify happy path ────────────────────────────────────────

  describe('test 4: verifyProfile sets verifiedAt + verifiedById and audits LIA_LICENCE_VERIFIED', () => {
    let target: SeededLia;
    let verifier: SeededLia;
    beforeEach(async () => {
      target = await seedLia(prisma, { withProfile: 'pending' });
      verifier = await seedLia(prisma);  // distinct user
    });
    afterEach(async () => {
      await cleanupLia(prisma, target);
      await cleanupLia(prisma, verifier);
    });

    it('updates both verify columns and writes the audit row', async () => {
      const actor = { id: verifier.userId, name: 'Owner Person', role: 'OWNER' };
      const before = new Date();
      const result = await service.verifyProfile(target.userId, actor);
      const after = new Date();

      expect(result.ok).toBe(true);
      expect(result.verifiedById).toBe(verifier.userId);
      expect(result.verifiedAt).toBeInstanceOf(Date);
      expect(result.verifiedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1);
      expect(result.verifiedAt!.getTime()).toBeLessThanOrEqual(after.getTime() + 1);

      const row = await prisma.liaProfile.findUnique({ where: { userId: target.userId } });
      expect(row?.iaaLicenceVerifiedAt).not.toBeNull();
      expect(row?.iaaLicenceVerifiedById).toBe(verifier.userId);

      const audit = await prisma.auditLog.findMany({
        where: {
          entityType: 'LIA_PROFILE',
          entityId: target.profileId,
          eventType: 'LIA_LICENCE_VERIFIED',
        },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.userId).toBe(verifier.userId);
      expect(audit[0]!.action).toBe('VERIFY');
      const nv = audit[0]!.newValue as Record<string, unknown>;
      expect(nv.liaUserId).toBe(target.userId);
      expect(nv.iaaLicenceNumber).toBe('654321');
    });
  });

  // ─── Test 5 — Self-verify / self-reject guards ─────────────────────────

  describe('test 5a: verifyProfile throws ForbiddenException on self-verify', () => {
    let lia: SeededLia;
    beforeEach(async () => { lia = await seedLia(prisma, { withProfile: 'pending' }); });
    afterEach(async () => { await cleanupLia(prisma, lia); });

    it('actor.id === target userId → ForbiddenException, no row mutation', async () => {
      const actor = { id: lia.userId, name: 'Self', role: 'OWNER' };
      await expect(
        service.verifyProfile(lia.userId, actor),
      ).rejects.toBeInstanceOf(ForbiddenException);

      const row = await prisma.liaProfile.findUnique({ where: { userId: lia.userId } });
      expect(row?.iaaLicenceVerifiedAt).toBeNull();
      expect(row?.iaaLicenceVerifiedById).toBeNull();

      // No audit row was written either.
      const audit = await prisma.auditLog.findMany({
        where: {
          entityType: 'LIA_PROFILE',
          entityId: lia.profileId,
          eventType: 'LIA_LICENCE_VERIFIED',
        },
      });
      expect(audit).toHaveLength(0);
    });
  });

  describe('test 5b: rejectProfile throws ForbiddenException on self-reject', () => {
    let lia: SeededLia;
    beforeEach(async () => { lia = await seedLia(prisma, { withProfile: 'pending' }); });
    afterEach(async () => { await cleanupLia(prisma, lia); });

    it('actor.id === target userId → ForbiddenException, no audit row written', async () => {
      const actor = { id: lia.userId, name: 'Self', role: 'OWNER' };
      await expect(
        service.rejectProfile(
          lia.userId,
          { reason: 'Self-rejection attempt blocked by guard.' },
          actor,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      const audit = await prisma.auditLog.findMany({
        where: {
          entityType: 'LIA_PROFILE',
          entityId: lia.profileId,
          eventType: 'LIA_LICENCE_REJECTED',
        },
      });
      expect(audit).toHaveLength(0);
    });
  });

  // ─── Test 6 — Reject keeps file + verify columns intact (D3) ───────────

  describe('test 6: rejectProfile writes audit but does NOT mutate the LiaProfile row', () => {
    let target: SeededLia;
    let verifier: SeededLia;
    beforeEach(async () => {
      target = await seedLia(prisma, { withProfile: 'pending' });
      verifier = await seedLia(prisma);
    });
    afterEach(async () => {
      await cleanupLia(prisma, target);
      await cleanupLia(prisma, verifier);
    });

    it('audit row written with reason; profile row file + verify columns unchanged', async () => {
      const before = await prisma.liaProfile.findUnique({ where: { userId: target.userId } });
      expect(before).not.toBeNull();

      const actor = { id: verifier.userId, name: 'Owner', role: 'OWNER' };
      const reason = 'Licence number does not match the IAA register entry.';
      const result = await service.rejectProfile(target.userId, { reason }, actor);
      expect(result.ok).toBe(true);
      expect(result.rejectedAt).toBeInstanceOf(Date);

      const after = await prisma.liaProfile.findUnique({ where: { userId: target.userId } });
      // Every file + verify column is identical pre/post-reject.
      expect(after?.iaaLicenceNumber).toBe(before!.iaaLicenceNumber);
      expect(after?.iaaLicenceFileUrl).toBe(before!.iaaLicenceFileUrl);
      expect(after?.iaaLicenceFileName).toBe(before!.iaaLicenceFileName);
      expect(after?.iaaLicenceFileMime).toBe(before!.iaaLicenceFileMime);
      expect(after?.iaaLicenceSizeBytes).toBe(before!.iaaLicenceSizeBytes);
      expect(after?.iaaLicenceVerifiedAt).toBe(before!.iaaLicenceVerifiedAt);
      expect(after?.iaaLicenceVerifiedById).toBe(before!.iaaLicenceVerifiedById);

      // The audit row carries the reason and points at the right profile.
      const audit = await prisma.auditLog.findMany({
        where: {
          entityType: 'LIA_PROFILE',
          entityId: target.profileId,
          eventType: 'LIA_LICENCE_REJECTED',
        },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.userId).toBe(verifier.userId);
      expect(audit[0]!.action).toBe('REJECT');
      const nv = audit[0]!.newValue as Record<string, unknown>;
      expect(nv.liaUserId).toBe(target.userId);
      expect(nv.reason).toBe(reason);
    });
  });
});
