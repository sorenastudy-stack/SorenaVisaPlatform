import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { EmailHashService } from './email-hash.service';

const VALID_SECRET_B64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // 32 zero bytes

const ORIG_ENV: { EMAIL_HASH_SECRET?: string } = {};

function setSecret(s?: string): void {
  if (s === undefined) delete process.env.EMAIL_HASH_SECRET;
  else process.env.EMAIL_HASH_SECRET = s;
}

async function buildService(): Promise<EmailHashService> {
  const mod: TestingModule = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true })],
    providers: [EmailHashService],
  }).compile();
  return mod.get<EmailHashService>(EmailHashService);
}

describe('EmailHashService', () => {
  beforeEach(() => {
    ORIG_ENV.EMAIL_HASH_SECRET = process.env.EMAIL_HASH_SECRET;
    setSecret(VALID_SECRET_B64);
  });

  afterEach(() => {
    setSecret(ORIG_ENV.EMAIL_HASH_SECRET);
  });

  describe('hash output', () => {
    it('returns a 64-char lowercase hex string', async () => {
      const svc = await buildService();
      const h = svc.hash('user@example.com');
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns the same hash for the same email (determinism)', async () => {
      const svc = await buildService();
      expect(svc.hash('user@example.com')).toBe(svc.hash('user@example.com'));
    });

    it('normalizes case — Test@Example.com === test@example.com', async () => {
      const svc = await buildService();
      expect(svc.hash('Test@Example.com')).toBe(svc.hash('test@example.com'));
    });

    it('trims whitespace — "  test@example.com  " === "test@example.com"', async () => {
      const svc = await buildService();
      expect(svc.hash('  test@example.com  ')).toBe(svc.hash('test@example.com'));
    });

    it('produces different hashes for different emails', async () => {
      const svc = await buildService();
      expect(svc.hash('a@example.com')).not.toBe(svc.hash('b@example.com'));
    });
  });

  describe('input validation', () => {
    it('throws on empty string', async () => {
      const svc = await buildService();
      expect(() => svc.hash('')).toThrow();
    });

    it('throws on whitespace-only string', async () => {
      const svc = await buildService();
      expect(() => svc.hash('   ')).toThrow();
    });
  });

  describe('verify', () => {
    it('returns true when the hash matches', async () => {
      const svc = await buildService();
      const email = 'user@example.com';
      const h = svc.hash(email);
      expect(svc.verify(email, h)).toBe(true);
    });

    it('returns false when the hash is wrong (same length)', async () => {
      const svc = await buildService();
      const wrong = '0'.repeat(64);
      expect(svc.verify('user@example.com', wrong)).toBe(false);
    });

    it('returns false on length mismatch — no throw', async () => {
      const svc = await buildService();
      expect(svc.verify('user@example.com', 'short')).toBe(false);
    });
  });

  describe('unicode', () => {
    it('handles Persian-character local part deterministically and round-trips verify', async () => {
      const svc = await buildService();
      const email = 'کاربر@example.com';
      const h1 = svc.hash(email);
      const h2 = svc.hash(email);
      expect(h1).toBe(h2);
      expect(svc.verify(email, h1)).toBe(true);
    });
  });

  describe('startup validation', () => {
    it('throws if EMAIL_HASH_SECRET is missing', async () => {
      setSecret(undefined);
      await expect(buildService()).rejects.toThrow(/EMAIL_HASH_SECRET is not set/);
    });

    it('throws if EMAIL_HASH_SECRET decodes to wrong length (16 bytes)', async () => {
      setSecret(Buffer.alloc(16).toString('base64'));
      await expect(buildService()).rejects.toThrow(/32 bytes/);
    });
  });
});
