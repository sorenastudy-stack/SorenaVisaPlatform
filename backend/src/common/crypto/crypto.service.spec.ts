import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { CryptoService } from './crypto.service';

const VALID_KEY_B64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // 32 zero bytes
const VALID_VERSION = '1';

// Save the keys we mutate so afterEach can restore exact prior state
const ORIG_ENV: { ENCRYPTION_KEY?: string; ENCRYPTION_KEY_VERSION?: string } = {};

function setEnv(key?: string, version?: string): void {
  if (key === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = key;
  if (version === undefined) delete process.env.ENCRYPTION_KEY_VERSION;
  else process.env.ENCRYPTION_KEY_VERSION = version;
}

async function buildService(): Promise<CryptoService> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true })],
    providers: [CryptoService],
  }).compile();
  return moduleRef.get<CryptoService>(CryptoService);
}

describe('CryptoService', () => {
  beforeEach(() => {
    ORIG_ENV.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
    ORIG_ENV.ENCRYPTION_KEY_VERSION = process.env.ENCRYPTION_KEY_VERSION;
    setEnv(VALID_KEY_B64, VALID_VERSION);
  });

  afterEach(() => {
    setEnv(ORIG_ENV.ENCRYPTION_KEY, ORIG_ENV.ENCRYPTION_KEY_VERSION);
  });

  describe('round-trip', () => {
    it('encrypts and decrypts ASCII plaintext', async () => {
      const svc = await buildService();
      const plain = 'hello world';
      const ct = svc.encrypt(plain);
      expect(svc.decrypt(ct)).toBe(plain);
    });

    it('encrypts and decrypts Persian Unicode plaintext', async () => {
      const svc = await buildService();
      const plain = 'سلام دنیا';
      const ct = svc.encrypt(plain);
      expect(svc.decrypt(ct)).toBe(plain);
    });

    it('encrypts and decrypts empty string', async () => {
      const svc = await buildService();
      const ct = svc.encrypt('');
      expect(svc.decrypt(ct)).toBe('');
    });

    it('produces different ciphertexts for the same plaintext (IV randomness)', async () => {
      const svc = await buildService();
      const plain = 'identical plaintext';
      const ct1 = svc.encrypt(plain);
      const ct2 = svc.encrypt(plain);
      expect(ct1.equals(ct2)).toBe(false);
    });
  });

  describe('tamper detection', () => {
    it('throws when a ciphertext byte is flipped', async () => {
      const svc = await buildService();
      const ct = svc.encrypt('hello world');
      const tampered = Buffer.from(ct);
      // Ciphertext body starts at byte 29 (1 version + 12 iv + 16 tag)
      tampered[29] = tampered[29] ^ 0xff;
      expect(() => svc.decrypt(tampered)).toThrow();
    });

    it('throws when an auth-tag byte is flipped', async () => {
      const svc = await buildService();
      const ct = svc.encrypt('hello world');
      const tampered = Buffer.from(ct);
      // Auth tag occupies bytes 13..28 inclusive
      tampered[13] = tampered[13] ^ 0xff;
      expect(() => svc.decrypt(tampered)).toThrow();
    });

    it('throws when version byte does not match the service', async () => {
      const svc = await buildService();
      const ct = svc.encrypt('hello world');
      const tampered = Buffer.from(ct);
      tampered[0] = 99; // not 1
      expect(() => svc.decrypt(tampered)).toThrow(/version/i);
    });

    it('throws when payload is shorter than the 29-byte header', async () => {
      const svc = await buildService();
      const tooShort = Buffer.alloc(28);
      expect(() => svc.decrypt(tooShort)).toThrow(/too short|at least 29/i);
    });
  });

  describe('startup validation', () => {
    it('throws if ENCRYPTION_KEY is missing', async () => {
      setEnv(undefined, VALID_VERSION);
      await expect(buildService()).rejects.toThrow(/ENCRYPTION_KEY is not set/);
    });

    it('throws if ENCRYPTION_KEY decodes to wrong length (16 bytes)', async () => {
      const sixteenZeroBytes = Buffer.alloc(16).toString('base64');
      setEnv(sixteenZeroBytes, VALID_VERSION);
      await expect(buildService()).rejects.toThrow(/32 bytes/);
    });

    it('throws if ENCRYPTION_KEY_VERSION is missing', async () => {
      setEnv(VALID_KEY_B64, undefined);
      await expect(buildService()).rejects.toThrow(/ENCRYPTION_KEY_VERSION is not set/);
    });
  });
});
