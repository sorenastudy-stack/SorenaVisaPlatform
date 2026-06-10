/**
 * PR-OPTION-C step 2 — null-passwordHash guard on password login.
 *
 * Verifies that an Option-C user (no password ever set) gets a clean
 * 401 from /auth/login instead of crashing bcrypt.compare on null.
 */

import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService.login — passwordHash null-guard (PR-OPTION-C step 2)', () => {

  function makeService(opts: {
    user: { id: string; email: string; name: string; role: string; passwordHash: string | null };
  }): AuthService {
    const prismaMock = {
      user: {
        findUnique: jest.fn().mockResolvedValue(opts.user),
      },
    };
    const jwtMock = { sign: jest.fn().mockReturnValue('jwt.fake.token') };
    return new AuthService(prismaMock as any, jwtMock as any);
  }

  it('null passwordHash → 401 "This account uses Google sign-in", no bcrypt call', async () => {
    const service = makeService({
      user: {
        id:           'user-1',
        email:        'google-only@example.com',
        name:         'Google Only User',
        role:         'ADMIN',
        passwordHash: null,
      },
    });

    let caught: any;
    try {
      await service.login('google-only@example.com', 'anything');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnauthorizedException);
    expect((caught as Error).message).toMatch(/Google sign-in/i);
  });

  it('email or password missing → generic "Invalid email or password" (pre-existing guard)', async () => {
    const service = makeService({
      user: {
        id:           'user-1',
        email:        'a@example.com',
        name:         'A',
        role:         'ADMIN',
        passwordHash: '$2b$10$something',
      },
    });

    await expect(service.login('', 'password')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.login('a@example.com', '')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
