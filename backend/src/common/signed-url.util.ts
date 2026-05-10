import * as jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'fallback_secret';
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
