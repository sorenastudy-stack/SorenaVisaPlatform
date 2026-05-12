import { CryptoService } from '../../common/crypto/crypto.service';

/**
 * Plaintext field names on AdmissionApplication that are stored encrypted.
 * Each maps to a sibling `<name>Encrypted` BYTEA column in the database.
 *
 * The ciphertext layout (set by CryptoService) embeds the key version as
 * the first byte, so no separate version column is required per field.
 */
export const ENCRYPTED_PII_FIELDS = [
  'passportNumber',
  'visaRefusalDetails',
  'disabilityDetails',
  'evacDetails',
  'medicalNotes',
  'otherStudyNotes',
  'guardianFirstName',
  'guardianLastName',
  'guardianMobile',
  'guardianHomePhone',
  'guardianStreet',
  'guardianSuburb',
  'guardianPostcode',
  'counsellorFirstName',
  'counsellorLastName',
  'agentComments',
] as const;

export type PiiField = typeof ENCRYPTED_PII_FIELDS[number];

const PII_SET: Set<string> = new Set(ENCRYPTED_PII_FIELDS);

/**
 * Map a plaintext input object to one where each PII field has been
 * replaced with `<name>Encrypted: Buffer | null`. Non-PII fields pass
 * through unchanged.
 *
 * Empty strings, null, and undefined are all normalized to `null` in
 * the encrypted column (i.e. they clear the value). Only non-empty
 * strings are encrypted.
 */
export function encryptPiiFields(
  crypto: CryptoService,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (PII_SET.has(key)) {
      if (value === null || value === undefined || value === '') {
        out[`${key}Encrypted`] = null;
      } else if (typeof value === 'string') {
        out[`${key}Encrypted`] = crypto.encrypt(value);
      } else {
        throw new Error(`PII field '${key}' must be string|null, got ${typeof value}`);
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Map a Prisma row containing `<name>Encrypted: Buffer | null` fields
 * back to an object with plaintext `<name>: string | null` fields.
 * `<name>Encrypted` keys are dropped from the output. Non-encrypted
 * fields pass through unchanged.
 *
 * Prisma returns BYTEA values as Buffer in Node, but Uint8Array is
 * accepted defensively in case of driver/version variance.
 */
export function decryptPiiFields(
  crypto: CryptoService,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.endsWith('Encrypted')) {
      const plainKey = key.slice(0, -'Encrypted'.length);
      if (!PII_SET.has(plainKey)) {
        // Unknown *Encrypted column — pass through verbatim (defensive)
        out[key] = value;
        continue;
      }
      if (value === null || value === undefined) {
        out[plainKey] = null;
      } else if (Buffer.isBuffer(value)) {
        out[plainKey] = crypto.decrypt(value);
      } else if (value instanceof Uint8Array) {
        out[plainKey] = crypto.decrypt(Buffer.from(value));
      } else {
        throw new Error(`PII field '${key}' must be Buffer|Uint8Array|null, got ${typeof value}`);
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}
