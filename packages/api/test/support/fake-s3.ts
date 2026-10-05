// In-memory stand-in for src/storage/s3.ts.
// Mock with: vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"))
export const objects = new Map<string, Buffer>();

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
  for (const k of [...objects.keys()]) if (k.startsWith(`${tripId}/`)) objects.delete(k);
}
