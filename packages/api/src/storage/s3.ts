// S3-compatible object storage for photo blobs. Works with MinIO, AWS S3,
// Cloudflare R2, Backblaze B2 — anything speaking the S3 API — selected purely by
// env (endpoint / region / path-style). Bytes stored are already envelope-encrypted
// (AES-GCM under a Vault datakey); the object store never sees plaintext.
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { config } from "../config.js";

export const s3 = new S3Client({
  region: config.S3_REGION,
  endpoint: config.S3_ENDPOINT, // undefined for AWS -> derived from region
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
  },
});

const Bucket = config.S3_BUCKET;

/**
 * Ensure the bucket exists. Creates it when missing (dev/MinIO). On managed
 * providers where the app's credentials can't create buckets, surface a clear
 * message telling the operator to pre-create it — rather than failing cryptically.
 */
export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket }));
    return; // exists and reachable
  } catch (e: any) {
    const status = e?.$metadata?.httpStatusCode;
    if (status === 403) return; // exists but HeadBucket forbidden — assume usable
    const missing = status === 404 || e?.name === "NotFound" || e?.name === "NoSuchBucket";
    if (!missing) throw e; // real failure (bad creds/endpoint/region) — fail fast
  }
  try {
    await s3.send(new CreateBucketCommand({ Bucket }));
  } catch (e: any) {
    if (e?.name === "BucketAlreadyOwnedByYou" || e?.name === "BucketAlreadyExists") return;
    throw new Error(
      `S3 bucket "${Bucket}" is missing and could not be created (${e?.name ?? e}). ` +
        `Create it on your provider and grant the app read/write, or grant CreateBucket.`,
    );
  }
}

export const blobKey = (tripId: string, submissionId: string) =>
  `${tripId}/${submissionId}`;

export async function putBlob(key: string, bytes: Buffer): Promise<void> {
  // Explicit ContentLength avoids chunked-transfer edge cases on some S3 impls.
  await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: bytes, ContentLength: bytes.length }));
}

export async function getBlob(key: string): Promise<Buffer> {
  const out = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
  const bytes = await out.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

/** Hard-delete every object for a Trip (Erasure step 1). Paginates + batch-deletes. */
export async function deleteTripBlobs(tripId: string): Promise<void> {
  let ContinuationToken: string | undefined;
  do {
    const list = await s3.send(
      new ListObjectsV2Command({ Bucket, Prefix: `${tripId}/`, ContinuationToken }),
    );
    const Objects = (list.Contents ?? [])
      .map((o) => ({ Key: o.Key! }))
      .filter((o) => o.Key);
    if (Objects.length) {
      await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects, Quiet: true } }));
    }
    ContinuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (ContinuationToken);
}
