import { createHash } from 'node:crypto';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ApiConfig } from '../config.js';
import { storageUnavailable } from './errors.js';

let client: S3Client | null = null;
let bucketReady: Promise<void> | null = null;

export function getS3(config: ApiConfig): S3Client {
  if (!client) {
    client = new S3Client({
      region: config.s3.region,
      endpoint: config.s3.endpoint.startsWith('http')
        ? config.s3.endpoint
        : `http://${config.s3.endpoint}`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.s3.accessKey,
        secretAccessKey: config.s3.secretKey,
      },
    });
  }
  return client;
}

export function resetS3(): void {
  client = null;
  bucketReady = null;
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Create the bucket if missing (idempotent). */
export async function ensureBucket(config: ApiConfig): Promise<void> {
  if (!bucketReady) {
    const s3 = getS3(config);
    bucketReady = (async () => {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
      } catch {
        try {
          await s3.send(new CreateBucketCommand({ Bucket: config.s3.bucket }));
        } catch (err) {
          // Bucket may have been created concurrently; only fail if it still
          // doesn't exist.
          try {
            await s3.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
          } catch {
            throw storageUnavailable(`Bucket create failed: ${(err as Error).message}`);
          }
        }
      }
    })();
  }
  return bucketReady;
}

export async function putObject(
  config: ApiConfig,
  key: string,
  body: Uint8Array | string,
  contentType = 'application/octet-stream',
): Promise<void> {
  await ensureBucket(config);
  try {
    await getS3(config).send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  } catch (err) {
    throw storageUnavailable(`Object put failed: ${(err as Error).message}`);
  }
}

export async function getObject(
  config: ApiConfig,
  key: string,
): Promise<Uint8Array | null> {
  try {
    const res = await getS3(config).send(
      new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }),
    );
    if (!res.Body) return null;
    const bytes = await res.Body.transformToByteArray();
    return new Uint8Array(bytes);
  } catch {
    return null;
  }
}

export async function presignPut(
  config: ApiConfig,
  key: string,
  expiresSeconds = 900,
): Promise<string> {
  try {
    return await getSignedUrl(
      getS3(config),
      new PutObjectCommand({ Bucket: config.s3.bucket, Key: key }),
      { expiresIn: expiresSeconds },
    );
  } catch (err) {
    throw storageUnavailable(`Presign failed: ${(err as Error).message}`);
  }
}

export async function presignGet(
  config: ApiConfig,
  key: string,
  expiresSeconds = 900,
): Promise<string> {
  try {
    return await getSignedUrl(
      getS3(config),
      new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }),
      { expiresIn: expiresSeconds },
    );
  } catch (err) {
    throw storageUnavailable(`Presign failed: ${(err as Error).message}`);
  }
}

/**
 * The API hands clients BOTH forms of an object URL:
 *  - the absolute presigned MinIO URL (usable by CLI / server-side fetches)
 *  - a same-origin `/s3/<bucket>/<key>?<same query>` path the browser uses so
 *    the web app never depends on MinIO CORS. Vite (and any reverse proxy)
 *    strips the `/s3` prefix and forwards to MinIO with Host = MinIO, which
 *    is the host the signature was computed over.
 */
export function signedPaths(presignedUrl: string): { url: string; path: string } {
  const u = new URL(presignedUrl);
  return { url: presignedUrl, path: `/s3${u.pathname}${u.search}` };
}
