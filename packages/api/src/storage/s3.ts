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
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { tagDependency } from "../lib/errors.js";

export const s3 = new S3Client({
  region: config.S3_REGION,
  endpoint: config.S3_ENDPOINT, // undefined for AWS -> derived from region
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
  },
});
// Tag every failure (network ones included, which carry no $metadata) as "storage", so the
// API answers 503 storage_unavailable instead of mistaking it for a database outage (#69).
s3.middlewareStack.add(
  (next) => (args) => next(args).catch((e: unknown) => { throw tagDependency(e, "storage"); }),
  { step: "initialize", name: "tagStorageErrors" },
);

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
// Throws if any object could not be deleted (#68). Errors name the S3 code only: object
// keys are opaque, but there's no reason to spread them into alerts and logs.
export async function deleteTripBlobs(tripId: string): Promise<void> {
  let ContinuationToken: string | undefined;
  do {
    const list = await s3
      .send(new ListObjectsV2Command({ Bucket, Prefix: `${tripId}/`, ContinuationToken }))
      .catch((e: Error) => {
        throw new Error(`could not list photos of trip ${tripId} for deletion (${e.name})`);
      });
    const Objects = (list.Contents ?? [])
      .map((o) => ({ Key: o.Key! }))
      .filter((o) => o.Key);
    if (Objects.length) {
      // Quiet still reports failures: S3/MinIO return per-object errors inside a 200.
      const res = await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects, Quiet: true } }));
      const errors = res?.Errors ?? [];
      if (errors.length) {
        const codes = [...new Set(errors.map((e) => e.Code ?? "unknown"))].join(", ");
        throw new Error(
          `could not delete ${errors.length} of ${Objects.length} photos of trip ${tripId} (${codes})`,
        );
      }
    }
    ContinuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (ContinuationToken);
}

// What a failure was, for an operator: the S3 code if there is one, else our own message.
const reasonOf = (e: unknown) =>
  (e instanceof Error ? (e.name && e.name !== "Error" ? e.name : e.message) : String(e)).split("\n", 1)[0]!.trim();

/**
 * Startup self-check (#69, #68): prove these credentials can do everything the app needs,
 * erasure's delete included, on a probe object outside any trip. Throws a message naming the
 * missing permission, so a bad bucket policy fails the boot instead of a teacher's "Erase now".
 */
export async function probeStorage(): Promise<void> {
  const key = `_selfcheck/${randomUUID()}`;
  const step = async (what: string, permission: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e: any) {
      // Only a refusal is a permission problem; anything else means we aren't talking to
      // working storage (wrong endpoint, another service on that port, storage down).
      const denied = e?.$metadata?.httpStatusCode === 403 || /AccessDenied|Forbidden/.test(reasonOf(e));
      throw new Error(
        `storage self-check: could not ${what} (${reasonOf(e)}). ` +
          (denied
            ? `The S3 credentials need ${permission} on bucket "${Bucket}".`
            : `Check that S3_ENDPOINT points at your object storage and that it is up.`),
      );
    }
  };
  await step("write a probe object", "s3:PutObject", () => putBlob(key, Buffer.from("selfcheck")));
  await step("list objects", "s3:ListBucket", async () => {
    const list = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: key }));
    if (!list.Contents?.some((o) => o.Key === key)) throw new Error("the probe object was not listed");
  });
  await step("read the probe object back", "s3:GetObject", async () => {
    if ((await getBlob(key)).toString() !== "selfcheck") throw new Error("the probe object came back different");
  });
  // The same list + DeleteObjects path erasure uses, per-object errors included.
  await step("delete the probe object", "s3:DeleteObject", () => deleteTripBlobs("_selfcheck"));
}

/** Readiness: is the bucket reachable? A 403 on HEAD still means reachable (see ensureBucket). */
export async function storageHealth(): Promise<"ok" | "down"> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket }));
    return "ok";
  } catch (e: any) {
    return e?.$metadata?.httpStatusCode === 403 ? "ok" : "down";
  }
}
