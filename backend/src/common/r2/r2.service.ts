import { Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Documents feature foundation — Cloudflare R2 (S3-compatible) client.
//
// Reads four env vars at construction with a fail-fast guard,
// matching the JwtStrategy pattern (throw at provider init, not at
// first call). The fail-fast only fires when this provider is
// actually instantiated by Nest; R2Module is not wired into any
// other module yet, so a service started without the R2_* vars will
// boot cleanly until the first import wires it in.
//
// All three methods take an opaque `key` (the object name inside the
// bucket). Path-style URLs are forced (R2 supports both but the SDK
// defaults to virtual-host style, which doesn't always work cleanly
// against R2's custom endpoint).

@Injectable()
export class R2Service {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const accessKeyId     = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const endpoint        = process.env.R2_ENDPOINT;
    const bucketName      = process.env.R2_BUCKET_NAME;

    if (!accessKeyId)     throw new Error('R2_ACCESS_KEY_ID is not set');
    if (!secretAccessKey) throw new Error('R2_SECRET_ACCESS_KEY is not set');
    if (!endpoint)        throw new Error('R2_ENDPOINT is not set');
    if (!bucketName)      throw new Error('R2_BUCKET_NAME is not set');

    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
    this.bucket = bucketName;
  }

  get bucketName(): string {
    return this.bucket;
  }

  // Upload a buffer straight to R2 from the backend (used where the server has
  // already received + validated the bytes, e.g. staff profile photos — the
  // server validates type/size on the actual bytes, which a presigned
  // client-direct PUT can't). Complements getPresignedUploadUrl (client-direct).
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    });
    await this.client.send(command);
  }

  async getPresignedUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds = 300,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async getPresignedDownloadUrl(
    key: string,
    expiresInSeconds = 300,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(command);
  }
}
