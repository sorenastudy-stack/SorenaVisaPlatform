import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

const SECRET_BYTES = 32;

@Injectable()
export class EmailHashService {
  private readonly secret: Buffer;

  constructor(config: ConfigService) {
    const raw = config.get<string>('EMAIL_HASH_SECRET');
    if (!raw) {
      throw new Error('EMAIL_HASH_SECRET is not set');
    }

    let decoded: Buffer;
    try {
      decoded = Buffer.from(raw, 'base64');
    } catch {
      throw new Error('EMAIL_HASH_SECRET is not valid base64');
    }
    if (decoded.length !== SECRET_BYTES) {
      throw new Error(
        `EMAIL_HASH_SECRET must decode to exactly ${SECRET_BYTES} bytes, got ${decoded.length}`,
      );
    }

    this.secret = decoded;
  }

  hash(email: string): string {
    if (typeof email !== 'string') {
      throw new Error('email must be a string');
    }
    const normalized = email.trim().toLowerCase();
    if (normalized.length === 0) {
      throw new Error('email must not be empty after normalization');
    }
    return createHmac('sha256', this.secret).update(normalized, 'utf8').digest('hex');
  }

  verify(email: string, hashHex: string): boolean {
    try {
      if (typeof hashHex !== 'string') return false;
      const expected = this.hash(email);
      if (hashHex.length !== expected.length) return false;
      const a = Buffer.from(expected, 'hex');
      const b = Buffer.from(hashHex, 'hex');
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}
