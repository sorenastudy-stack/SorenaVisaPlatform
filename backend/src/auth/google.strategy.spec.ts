/**
 * PR-OPTION-C step 2 — invite-only Google OAuth strategy.
 *
 * verifyGoogleProfile() is the unit under test (validate() is a thin
 * passport-callback wrapper around it). We mock the PrismaService
 * surface with just findFirst + update.
 */

import { UnauthorizedException } from '@nestjs/common';
import { GoogleStrategy } from './google.strategy';

interface MockProfile {
  id:      string;
  emails?: Array<{ value: string; verified?: boolean }>;
  name?:   { givenName?: string; familyName?: string };
}

function makeProfile(overrides: Partial<MockProfile> = {}): any {
  return {
    id: 'google-sub-123',
    emails: [{ value: 'invited@example.com', verified: true }],
    name: { givenName: 'Test', familyName: 'User' },
    ...overrides,
  };
}

function makeStrategy(prismaMock: any): GoogleStrategy {
  // The strategy constructor reads GOOGLE_* env vars; the passport
  // base class accepts empty strings here without throwing as long
  // as we never call passport's authenticate() in unit tests.
  process.env.GOOGLE_CLIENT_ID     = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_CALLBACK_URL  = 'http://localhost:3001/auth/google/callback';
  return new GoogleStrategy(prismaMock);
}

describe('GoogleStrategy (PR-OPTION-C step 2)', () => {

  describe('verifyGoogleProfile (invite-only enforcement)', () => {

    it('(a) unknown email → 401 Not authorized, no row created', async () => {
      const findFirst = jest.fn().mockResolvedValue(null);
      const update    = jest.fn();
      const strategy  = makeStrategy({ user: { findFirst, update } });

      await expect(
        strategy.verifyGoogleProfile(makeProfile()),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(findFirst).toHaveBeenCalledTimes(1);
      // Critical: no create()/update() — invite-only must not provision.
      expect(update).not.toHaveBeenCalled();
    });

    it('(b) known email, null googleId → links googleId + lastLoginAt + succeeds', async () => {
      const userRow = {
        id:       'user-1',
        email:    'invited@example.com',
        name:     'Test User',
        role:     'ADMIN',
        isActive: true,
        googleId: null,
      };
      const findFirst = jest.fn().mockResolvedValue(userRow);
      const update    = jest.fn().mockResolvedValue({});
      const strategy  = makeStrategy({ user: { findFirst, update } });

      const result = await strategy.verifyGoogleProfile(makeProfile());

      expect(result).toEqual({
        id:    'user-1',
        email: 'invited@example.com',
        role:  'ADMIN',
        name:  'Test User',
      });
      // First-time link: googleId AND lastLoginAt set in one update.
      expect(update).toHaveBeenCalledTimes(1);
      const data = update.mock.calls[0][0].data;
      expect(data.googleId).toBe('google-sub-123');
      expect(data.lastLoginAt).toBeInstanceOf(Date);
    });

    it('(c) known email, googleId set but mismatched → 401, no update', async () => {
      const findFirst = jest.fn().mockResolvedValue({
        id:       'user-2',
        email:    'invited@example.com',
        name:     'Test User',
        role:     'LIA',
        isActive: true,
        googleId: 'a-different-google-sub-456',
      });
      const update   = jest.fn();
      const strategy = makeStrategy({ user: { findFirst, update } });

      await expect(
        strategy.verifyGoogleProfile(makeProfile()),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(update).not.toHaveBeenCalled();
    });

    it('(d) inactive user → 401, no update', async () => {
      const findFirst = jest.fn().mockResolvedValue({
        id:       'user-3',
        email:    'invited@example.com',
        name:     'Test User',
        role:     'ADMIN',
        isActive: false,
        googleId: null,
      });
      const update   = jest.fn();
      const strategy = makeStrategy({ user: { findFirst, update } });

      await expect(
        strategy.verifyGoogleProfile(makeProfile()),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(update).not.toHaveBeenCalled();
    });

    it('(e) returning Google user (same googleId) → bumps lastLoginAt only, succeeds', async () => {
      const findFirst = jest.fn().mockResolvedValue({
        id:       'user-4',
        email:    'invited@example.com',
        name:     'Test User',
        role:     'OWNER',
        isActive: true,
        googleId: 'google-sub-123',
      });
      const update   = jest.fn().mockResolvedValue({});
      const strategy = makeStrategy({ user: { findFirst, update } });

      const result = await strategy.verifyGoogleProfile(makeProfile());

      expect(result.id).toBe('user-4');
      expect(update).toHaveBeenCalledTimes(1);
      const data = update.mock.calls[0][0].data;
      // No googleId in this update — only lastLoginAt.
      expect(data.googleId).toBeUndefined();
      expect(data.lastLoginAt).toBeInstanceOf(Date);
    });

    it('(f) Google profile missing verified email → 401', async () => {
      const findFirst = jest.fn();
      const update    = jest.fn();
      const strategy  = makeStrategy({ user: { findFirst, update } });

      await expect(
        strategy.verifyGoogleProfile(
          makeProfile({ emails: [{ value: 'x@y.com', verified: false }] }),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(findFirst).not.toHaveBeenCalled();
    });

    it('(g) Google profile missing id → 401', async () => {
      const findFirst = jest.fn();
      const update    = jest.fn();
      const strategy  = makeStrategy({ user: { findFirst, update } });

      await expect(
        strategy.verifyGoogleProfile(makeProfile({ id: undefined as any })),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(findFirst).not.toHaveBeenCalled();
    });

    it('email lookup is case-insensitive (lowercases before query)', async () => {
      const findFirst = jest.fn().mockResolvedValue(null);
      const update    = jest.fn();
      const strategy  = makeStrategy({ user: { findFirst, update } });

      await expect(
        strategy.verifyGoogleProfile(
          makeProfile({ emails: [{ value: 'Invited@Example.COM', verified: true }] }),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      // Email argument was normalised to lowercase before lookup.
      const whereClause = findFirst.mock.calls[0][0].where;
      expect(whereClause.email.equals).toBe('invited@example.com');
      expect(whereClause.email.mode).toBe('insensitive');
    });
  });
});
