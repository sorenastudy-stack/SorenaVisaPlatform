import { JwtService } from '@nestjs/jwt';
import { IdentityThrottlerGuard } from './identity-throttler.guard';

// PR-RATE-LIMIT-IDENTITY — the tracker decides which bucket a request counts
// against, so these assert the KEY, which is the whole of the fix.
//
// The end-to-end proof lives outside CI: two real clients calling a real
// endpoint from one address, run against both the old and the new guard. The
// old one failed it (client B got 429 purely because client A had spent the
// shared bucket); the new one passes. These tests pin the logic that made the
// difference.

const SECRET = 'test-secret-for-the-throttler-spec';

describe('IdentityThrottlerGuard — bucket key', () => {
  const jwt = new JwtService({ secret: SECRET });
  // The base class is never constructed here: getTracker only needs `jwt`.
  const guard = Object.create(IdentityThrottlerGuard.prototype) as IdentityThrottlerGuard;
  (guard as unknown as { jwt: JwtService }).jwt = jwt;
  const track = (req: unknown) =>
    (guard as unknown as { getTracker(r: unknown): Promise<string> }).getTracker(req);

  const req = (headers: Record<string, string>, ip = '203.0.113.9') => ({ headers, ip });
  const bearer = (payload: object) => ({ authorization: `Bearer ${jwt.sign(payload)}` });

  it('keys an authenticated request by its user, not its address', async () => {
    expect(await track(req(bearer({ sub: 'user-abc' })))).toBe('user:user-abc');
  });

  it('gives two different users different buckets from ONE address', async () => {
    const a = await track(req(bearer({ sub: 'user-a' }), '10.0.0.1'));
    const b = await track(req(bearer({ sub: 'user-b' }), '10.0.0.1'));
    expect(a).not.toBe(b);
  });

  it('gives one user ONE bucket across different addresses', async () => {
    const a = await track(req(bearer({ sub: 'same-user' }), '10.0.0.1'));
    const b = await track(req(bearer({ sub: 'same-user' }), '198.51.100.7'));
    expect(a).toBe(b);
  });

  it('falls back to the address when there is no token', async () => {
    expect(await track(req({}, '203.0.113.9'))).toBe('ip:203.0.113.9');
  });

  // The security property: a forged token must not mint a private allowance.
  it('IGNORES a token signed with the wrong secret', async () => {
    const forged = new JwtService({ secret: 'wrong-secret' }).sign({ sub: 'attacker' });
    expect(await track(req({ authorization: `Bearer ${forged}` }))).toBe('ip:203.0.113.9');
  });

  it('IGNORES a tampered token', async () => {
    const good = jwt.sign({ sub: 'victim' });
    const tampered = good.slice(0, -4) + 'AAAA';
    expect(await track(req({ authorization: `Bearer ${tampered}` }))).toBe('ip:203.0.113.9');
  });

  it('IGNORES an expired token', async () => {
    const expired = jwt.sign({ sub: 'lapsed' }, { expiresIn: '-1s' });
    expect(await track(req({ authorization: `Bearer ${expired}` }))).toBe('ip:203.0.113.9');
  });

  it('ignores a malformed or non-Bearer Authorization header', async () => {
    for (const authorization of ['Basic abc', 'Bearer', 'Bearer not-a-jwt', '']) {
      expect(await track(req({ authorization }))).toBe('ip:203.0.113.9');
    }
  });

  it('ignores a token whose sub is missing or not a string', async () => {
    for (const payload of [{}, { sub: 42 }, { sub: '' }]) {
      expect(await track(req(bearer(payload)))).toBe('ip:203.0.113.9');
    }
  });

  // Without the prefixes, a user id that looked like an address would collide
  // with that address's bucket.
  it('namespaces user keys apart from address keys', async () => {
    const asUser = await track(req(bearer({ sub: '203.0.113.9' })));
    const asIp = await track(req({}, '203.0.113.9'));
    expect(asUser).toBe('user:203.0.113.9');
    expect(asIp).toBe('ip:203.0.113.9');
    expect(asUser).not.toBe(asIp);
  });

  it('never throws on a request with no headers at all', async () => {
    await expect(track({})).resolves.toBe('ip:unknown');
  });
});
