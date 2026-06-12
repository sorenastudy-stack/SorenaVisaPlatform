import * as jwt from 'jsonwebtoken';

// PR-AUDIT-2 — fail-fast at import time if JWT_SECRET is missing.
// This module-level const evaluates the first time anything imports
// from this file; throwing here crashes app boot via the importing
// module's init. Mirrors CryptoService '<VAR> is not set'.
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('JWT_SECRET is not set');
const TTL_SECONDS = 5 * 60;

export interface SignedFilePayload {
  fileUrl: string;
  fileName: string;
  mimeType: string;
}

export function createSignedDownloadToken(payload: SignedFilePayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: TTL_SECONDS });
}

export function verifySignedDownloadToken(token: string): SignedFilePayload {
  return jwt.verify(token, SECRET) as SignedFilePayload;
}
