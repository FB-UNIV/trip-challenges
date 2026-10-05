// In-memory stand-in for src/storage/s3.ts.
// Mock with: vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"))
export const objects = new Map<string, Buffer>();
/** Fault injection: the next `deleteFailures` calls to deleteTripBlobs throw. */
export const s3faults = { deleteFailures: 0 };

export async function ensureBucket(): Promise<void> {}

export const blobKey = (tripId: string, submissionId: string) => `${tripId}/${submissionId}`;

export async function putBlob(key: string, bytes: Buffer): Promise<void> {
  objects.set(key, Buffer.from(bytes));
}

export async function getBlob(key: string): Promise<Buffer> {
  const b = objects.get(key);
  if (!b) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
  return b;
}

export async function deleteTripBlobs(tripId: string): Promise<void> {
  if (s3faults.deleteFailures > 0) {
    s3faults.deleteFailures--;
    throw new Error("S3 503 SlowDown");
  }
  for (const k of [...objects.keys()]) if (k.startsWith(`${tripId}/`)) objects.delete(k);
}
