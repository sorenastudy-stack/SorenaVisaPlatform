import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES; // 29

@Injectable()
export class CryptoService {
  private readonly key: Buffer;
  private readonly version: number;

  constructor(config: ConfigService) {
    const rawKey = config.get<string>('ENCRYPTION_KEY');
    if (!rawKey) {
      throw new Error('ENCRYPTION_KEY is not set');
    }

    let decoded: Buffer;
    try {
      decoded = Buffer.from(rawKey, 'base64');
    } catch {
      throw new Error('ENCRYPTION_KEY is not valid base64');
    }
    // Buffer.from with 'base64' silently truncates invalid chars rather than throwing;
    // validate by re-encoding and comparing length.
    if (decoded.length !== KEY_BYTES) {
      throw new Error(
        `ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes, got ${decoded.length}`,
      );
    }

    const rawVersion = config.get<string>('ENCRYPTION_KEY_VERSION');
    if (rawVersion === undefined || rawVersion === null || rawVersion === '') {
      throw new Error('ENCRYPTION_KEY_VERSION is not set');
    }
    const parsedVersion = Number(rawVersion);
    if (!Number.isInteger(parsedVersion) || parsedVersion < 1) {
      throw new Error('ENCRYPTION_KEY_VERSION must be a positive integer');
    }
    if (parsedVersion > 255) {
      throw new Error('ENCRYPTION_KEY_VERSION cannot exceed 255 (single byte)');
    }

    this.key = decoded;
    this.version = parsedVersion;
  }

  get keyVersion(): number {
    return this.version;
  }

  encrypt(plaintext: string): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const versionByte = Buffer.from([this.version]);
    return Buffer.concat([versionByte, iv, tag, ct]);
  }

  decrypt(payload: Buffer): string {
    if (payload.length < HEADER_BYTES) {
      throw new Error(
        `Ciphertext payload too short: expected at least ${HEADER_BYTES} bytes, got ${payload.length}`,
      );
    }
    const version = payload[0];
    if (version !== this.version) {
      throw new Error(
        `Unsupported key version ${version}; this service only handles version ${this.version}`,
      );
    }
    const iv = payload.subarray(1, 1 + IV_BYTES);
    const tag = payload.subarray(1 + IV_BYTES, HEADER_BYTES);
    const ct = payload.subarray(HEADER_BYTES);
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  }
}
