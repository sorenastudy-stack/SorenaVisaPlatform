import { PrismaClient } from '@prisma/client';
import {
  daysUntilExpiry,
  isLicenceCurrent,
  isLicenceExpired,
} from './licence-validity';
import { LicenceExpiryCronService } from './licence-expiry-cron.service';

/**
 * PR-AGENT-PORTAL phase 0 — licence expiry.
 *
 * The properties worth pinning are the ones that would either let a lapsed
 * adviser keep working or lock out a valid one:
 *   - a licence is valid THROUGH its expiry date, not until the morning of it
 *   - a missing date is NOT an expired licence (every existing row has none)
 *   - a renewal clears the flag, or a renewed adviser stays locked out forever
 */

jest.setTimeout(90000);

const d = (iso: string) => new Date(`${iso}T12:00:00`);

describe('licence validity (pure)', () => {
  const verified = { iaaLicenceVerifiedAt: new Date('2026-01-01') };

  it('treats a missing expiry as not expired', () => {
    // Every row predates the field. A data gap must not read as a licence
    // failure and lock out the advisers already working.
    expect(isLicenceExpired({ licenceExpiryDate: null })).toBe(false);
    expect(isLicenceExpired(undefined)).toBe(false);
  });

  it.each([
    ['the day before expiry', '2026-08-11', false],
    ['the expiry date itself', '2026-08-12', false],
    ['the day after expiry', '2026-08-13', true],
  ])('%s → expired=%s', (_label, today, expected) => {
    // Expiry 12 Aug: valid all through the 12th, gone on the 13th — how a
    // licence reads on paper, and how the adviser will read it.
    expect(isLicenceExpired({ licenceExpiryDate: d('2026-08-12') }, d(today))).toBe(expected);
  });

  it('requires BOTH verification and an unexpired date to be current', () => {
    const future = d('2027-01-01');
    expect(isLicenceCurrent({ ...verified, licenceExpiryDate: future }, d('2026-08-12'))).toBe(true);
    // Verified but lapsed.
    expect(isLicenceCurrent({ ...verified, licenceExpiryDate: d('2026-01-01') }, d('2026-08-12'))).toBe(false);
    // In date but never verified.
    expect(isLicenceCurrent({ iaaLicenceVerifiedAt: null, licenceExpiryDate: future }, d('2026-08-12'))).toBe(false);
  });

  it('counts days to expiry, and negative once past', () => {
    expect(daysUntilExpiry({ licenceExpiryDate: d('2026-08-14') }, d('2026-08-12'))).toBe(2);
    expect(daysUntilExpiry({ licenceExpiryDate: d('2026-08-12') }, d('2026-08-12'))).toBe(0);
    expect(daysUntilExpiry({ licenceExpiryDate: d('2026-08-10') }, d('2026-08-12'))).toBeLessThan(0);
    expect(daysUntilExpiry({ licenceExpiryDate: null })).toBeNull();
  });
});

describe('LicenceExpiryCronService.sweep', () => {
  let prisma: PrismaClient;
  let svc: LicenceExpiryCronService;
  const made: string[] = [];

  async function mkProfile(expiry: Date | null, flagged = false) {
    const s = `lic${Date.now()}_${made.length}`;
    const u = await prisma.user.create({
      data: { name: `L ${s}`, email: `${s}@t.local`, passwordHash: 'x', role: 'LIA', isActive: true },
    });
    made.push(u.id);
    await prisma.liaProfile.create({
      data: {
        userId: u.id,
        iaaLicenceVerifiedAt: new Date('2026-01-01'),
        licenceExpiryDate: expiry,
        isLicenceExpired: flagged,
      },
    });
    return u.id;
  }

  const flagOf = async (userId: string) =>
    (await prisma.liaProfile.findUniqueOrThrow({ where: { userId } })).isLicenceExpired;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    svc = new LicenceExpiryCronService(prisma as any);
  }, 90000);

  afterAll(async () => {
    await prisma.liaProfile.deleteMany({ where: { userId: { in: made } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: made } } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('flags a lapsed licence and leaves a current one alone', async () => {
    const lapsed = await mkProfile(d('2026-08-01'));
    const current = await mkProfile(d('2027-01-01'));

    await svc.sweep(d('2026-08-12'));

    expect(await flagOf(lapsed)).toBe(true);
    expect(await flagOf(current)).toBe(false);
  });

  it('clears the flag when a licence is renewed', async () => {
    // Without this, an adviser who renewed stays expired in every queue until
    // somebody edits the database by hand.
    const renewed = await mkProfile(d('2027-06-01'), true);
    await svc.sweep(d('2026-08-12'));
    expect(await flagOf(renewed)).toBe(false);
  });

  it('never flags a licence with no expiry recorded', async () => {
    const noDate = await mkProfile(null);
    await svc.sweep(d('2026-08-12'));
    expect(await flagOf(noDate)).toBe(false);
  });

  it('does not flag on the expiry date itself, only after it', async () => {
    const expiringToday = await mkProfile(d('2026-08-12'));
    await svc.sweep(d('2026-08-12'));
    expect(await flagOf(expiringToday)).toBe(false);

    await svc.sweep(d('2026-08-13'));
    expect(await flagOf(expiringToday)).toBe(true);
  });

  it('reports what it changed', async () => {
    const a = await mkProfile(d('2026-01-01'));
    const res = await svc.sweep(d('2026-08-12'));
    expect(res.expired).toBeGreaterThanOrEqual(1);
    expect(await flagOf(a)).toBe(true);
  });
});
