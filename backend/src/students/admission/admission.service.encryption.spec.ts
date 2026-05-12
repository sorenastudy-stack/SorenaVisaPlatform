import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { CryptoService } from '../../common/crypto/crypto.service';
import {
  ENCRYPTED_PII_FIELDS,
  encryptPiiFields,
  decryptPiiFields,
} from './admission-encryption.util';

const TEST_KEY_B64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // 32 zero bytes
const TEST_VERSION = '1';

// Payload header is [version:1][iv:12][tag:16] = 29 bytes; ciphertext appended.
const MIN_CIPHERTEXT_BYTES = 29;

const ORIG_ENV: { ENCRYPTION_KEY?: string; ENCRYPTION_KEY_VERSION?: string } = {};

function setEnv(key?: string, version?: string): void {
  if (key === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = key;
  if (version === undefined) delete process.env.ENCRYPTION_KEY_VERSION;
  else process.env.ENCRYPTION_KEY_VERSION = version;
}

async function buildCrypto(): Promise<CryptoService> {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true })],
    providers: [CryptoService],
  }).compile();
  return moduleRef.get<CryptoService>(CryptoService);
}

function allFieldsPopulated(): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const f of ENCRYPTED_PII_FIELDS) {
    obj[f] = `plaintext-for-${f}`;
  }
  return obj;
}

describe('AdmissionService — PII encryption utility', () => {
  let crypto: CryptoService;

  beforeEach(async () => {
    ORIG_ENV.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
    ORIG_ENV.ENCRYPTION_KEY_VERSION = process.env.ENCRYPTION_KEY_VERSION;
    setEnv(TEST_KEY_B64, TEST_VERSION);
    crypto = await buildCrypto();
  });

  afterEach(() => {
    setEnv(ORIG_ENV.ENCRYPTION_KEY, ORIG_ENV.ENCRYPTION_KEY_VERSION);
  });

  describe('encrypt path', () => {
    it('encrypts all 16 PII fields when populated; each *Encrypted is a Buffer of at least 29 bytes', () => {
      const out = encryptPiiFields(crypto, allFieldsPopulated());
      for (const f of ENCRYPTED_PII_FIELDS) {
        const encKey = `${f}Encrypted`;
        const v = out[encKey];
        expect(Buffer.isBuffer(v)).toBe(true);
        expect((v as Buffer).length).toBeGreaterThanOrEqual(MIN_CIPHERTEXT_BYTES);
        // Plaintext key must not appear in the output
        expect(out).not.toHaveProperty(f);
      }
    });

    it('renders null/undefined PII inputs as null on the corresponding *Encrypted column', () => {
      const out = encryptPiiFields(crypto, {
        passportNumber: null,
        guardianFirstName: undefined,
        medicalNotes: 'real value',
      });
      expect(out.passportNumberEncrypted).toBeNull();
      expect(out.guardianFirstNameEncrypted).toBeNull();
      expect(Buffer.isBuffer(out.medicalNotesEncrypted)).toBe(true);
    });

    it('normalizes empty string to null (treated as "clear this field"), documented behavior', () => {
      const out = encryptPiiFields(crypto, { passportNumber: '', disabilityDetails: '' });
      expect(out.passportNumberEncrypted).toBeNull();
      expect(out.disabilityDetailsEncrypted).toBeNull();
    });

    it('passes non-PII fields through unchanged', () => {
      const out = encryptPiiFields(crypto, {
        currentStep: 3,
        hasDisability: true,
        phone: '+64 21 0000',
        passportNumber: 'A12345678',
      });
      expect(out.currentStep).toBe(3);
      expect(out.hasDisability).toBe(true);
      expect(out.phone).toBe('+64 21 0000');
      expect(Buffer.isBuffer(out.passportNumberEncrypted)).toBe(true);
      expect(out).not.toHaveProperty('passportNumber');
    });
  });

  describe('decrypt path', () => {
    it('decrypts populated *Encrypted buffers back to their plaintext keys', () => {
      const encrypted = encryptPiiFields(crypto, allFieldsPopulated());
      const decrypted = decryptPiiFields(crypto, encrypted);
      for (const f of ENCRYPTED_PII_FIELDS) {
        expect(decrypted[f]).toBe(`plaintext-for-${f}`);
        // *Encrypted key must not appear in the output
        expect(decrypted).not.toHaveProperty(`${f}Encrypted`);
      }
    });

    it('returns null on the plaintext key when the *Encrypted column is null', () => {
      const decrypted = decryptPiiFields(crypto, {
        passportNumberEncrypted: null,
        medicalNotesEncrypted: null,
        guardianFirstNameEncrypted: null,
      });
      expect(decrypted.passportNumber).toBeNull();
      expect(decrypted.medicalNotes).toBeNull();
      expect(decrypted.guardianFirstName).toBeNull();
    });

    it('preserves non-encrypted fields verbatim', () => {
      const decrypted = decryptPiiFields(crypto, {
        currentStep: 5,
        hasDisability: false,
        phone: '+64 21 0000',
        passportNumberEncrypted: null,
      });
      expect(decrypted.currentStep).toBe(5);
      expect(decrypted.hasDisability).toBe(false);
      expect(decrypted.phone).toBe('+64 21 0000');
      expect(decrypted.passportNumber).toBeNull();
    });
  });

  describe('round-trip', () => {
    it('Persian text in disabilityDetails survives encrypt → decrypt', () => {
      const plaintext = 'سلام دنیا';
      const enc = encryptPiiFields(crypto, { disabilityDetails: plaintext });
      const dec = decryptPiiFields(crypto, enc);
      expect(dec.disabilityDetails).toBe(plaintext);
    });

    it('passport number survives encrypt → decrypt', () => {
      const plaintext = 'A12345678';
      const enc = encryptPiiFields(crypto, { passportNumber: plaintext });
      const dec = decryptPiiFields(crypto, enc);
      expect(dec.passportNumber).toBe(plaintext);
    });
  });

  describe('tamper detection', () => {
    it('decryptPiiFields throws when a ciphertext byte in a returned buffer is mutated', () => {
      const enc = encryptPiiFields(crypto, { passportNumber: 'A12345678' });
      const buf = enc.passportNumberEncrypted as Buffer;
      const tampered = Buffer.from(buf);
      // Mutate inside the ciphertext region (offset 29+, after version+iv+tag)
      tampered[tampered.length - 1] ^= 0xff;
      expect(() =>
        decryptPiiFields(crypto, { passportNumberEncrypted: tampered }),
      ).toThrow();
    });
  });
});
