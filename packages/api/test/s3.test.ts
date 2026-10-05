import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../src/config.js", () => import("./support/config.js"));

// Minimal @aws-sdk/client-s3: each command records its name + input; send() is scripted.
const s3 = vi.hoisted(() => ({
  sent: [] as { cmd: string; input: any }[],
  handler: (_cmd: string, _input: any): any => ({}),
}));
vi.mock("@aws-sdk/client-s3", () => {
  const cmd = (name: string) => class { readonly cmd = name; constructor(public input: any) {} };
  return {
    S3Client: class {
      async send(c: { cmd: string; input: any }) {
        s3.sent.push({ cmd: c.cmd, input: c.input });
        return s3.handler(c.cmd, c.input);
      }
    },
    HeadBucketCommand: cmd("HeadBucket"),
    CreateBucketCommand: cmd("CreateBucket"),
    PutObjectCommand: cmd("PutObject"),
    GetObjectCommand: cmd("GetObject"),
    ListObjectsV2Command: cmd("ListObjectsV2"),
    DeleteObjectsCommand: cmd("DeleteObjects"),
  };
});

import { ensureBucket, blobKey, putBlob, getBlob, deleteTripBlobs } from "../src/storage/s3.js";

const err = (name: string, status?: number) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

beforeEach(() => {
  s3.sent = [];
  s3.handler = () => ({});
});

const cmds = () => s3.sent.map((s) => s.cmd);

describe("ensureBucket", () => {
  it("does nothing when the bucket exists", async () => {
    await ensureBucket();
    expect(cmds()).toEqual(["HeadBucket"]);
  });

  it("assumes a bucket it may not HEAD (403) is usable", async () => {
    s3.handler = (c) => { if (c === "HeadBucket") throw err("Forbidden", 403); };
    await ensureBucket();
    expect(cmds()).toEqual(["HeadBucket"]);
  });

  it("creates a missing bucket, tolerating a creation race", async () => {
    s3.handler = (c) => { if (c === "HeadBucket") throw err("NotFound", 404); };
    await ensureBucket();
    expect(cmds()).toEqual(["HeadBucket", "CreateBucket"]);
    expect(s3.sent[1]!.input).toEqual({ Bucket: "submissions" });

    s3.handler = (c) => { throw c === "HeadBucket" ? err("NoSuchBucket") : err("BucketAlreadyOwnedByYou"); };
    await expect(ensureBucket()).resolves.toBeUndefined();
  });

  it("explains how to fix a bucket it cannot create", async () => {
    s3.handler = (c) => { throw c === "HeadBucket" ? err("NotFound", 404) : err("AccessDenied", 403); };
    await expect(ensureBucket()).rejects.toThrow(/bucket "submissions" is missing and could not be created \(AccessDenied\)/);
  });

  it("fails fast on other errors (bad credentials/endpoint)", async () => {
    s3.handler = () => { throw err("InvalidAccessKeyId", 400); };
    await expect(ensureBucket()).rejects.toThrow("InvalidAccessKeyId");
  });
});

describe("objects", () => {
  it("keys blobs under the trip prefix", () => {
    expect(blobKey("trip", "sub")).toBe("trip/sub");
  });

  it("puts with an explicit length and reads back bytes", async () => {
    await putBlob("t/s", Buffer.from("abc"));
    expect(s3.sent[0]!.input).toEqual({ Bucket: "submissions", Key: "t/s", Body: Buffer.from("abc"), ContentLength: 3 });

    s3.handler = () => ({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } });
    const got = await getBlob("t/s");
    expect(Buffer.isBuffer(got) && [...got]).toEqual([1, 2, 3]);
  });

  it("deletes every object for a trip across pages, skipping empty pages", async () => {
    const pages = [
      { Contents: [{ Key: "t/1" }, { Key: "t/2" }], IsTruncated: true, NextContinuationToken: "p2" },
      { Contents: [], IsTruncated: true, NextContinuationToken: "p3" },
      { Contents: [{ Key: "t/3" }], IsTruncated: false },
    ];
    s3.handler = (c) => (c === "ListObjectsV2" ? pages.shift() : {});
    await deleteTripBlobs("t");

    const lists = s3.sent.filter((s) => s.cmd === "ListObjectsV2").map((s) => s.input);
    expect(lists.map((l) => [l.Prefix, l.ContinuationToken])).toEqual([["t/", undefined], ["t/", "p2"], ["t/", "p3"]]);
    const deletes = s3.sent.filter((s) => s.cmd === "DeleteObjects").map((s) => s.input.Delete.Objects.map((o: any) => o.Key));
    expect(deletes).toEqual([["t/1", "t/2"], ["t/3"]]);
  });
});
