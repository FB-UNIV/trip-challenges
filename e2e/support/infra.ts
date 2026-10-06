// Direct probes of the real data stores, to verify erasure beyond what the API shows.
import pg from "pg";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { PG, S3_BUCKET, S3_ENDPOINT, S3_KEY, S3_SECRET, VAULT_ADDR, VAULT_TOKEN } from "./env.js";

const pool = new pg.Pool({ ...PG, max: 2, allowExitOnIdle: true });

const s3 = new S3Client({
  region: "us-east-1",
  endpoint: S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: S3_KEY, secretAccessKey: S3_SECRET },
});

/** Rows for a trip in a trip-scoped table. */
export async function rowsFor(table: string, tripId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE trip_id = $1`, [tripId]);
  return rows[0]!.n;
}

export async function tripPhase(tripId: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ phase: string }>(`SELECT phase FROM trip WHERE id = $1`, [tripId]);
  return rows[0]?.phase;
}

/** Ciphertext of one team name, to try decrypting after the key is destroyed. */
export async function anyTeamNameCiphertext(tripId: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ name_enc: Buffer }>(`SELECT name_enc FROM team WHERE trip_id = $1 LIMIT 1`, [tripId]);
  return rows[0]?.name_enc.toString("utf8");
}

export async function blobCount(tripId: string): Promise<number> {
  const out = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: `${tripId}/` }));
  return out.KeyCount ?? 0;
}

export async function vaultKeyExists(tripId: string): Promise<boolean> {
  const res = await fetch(`${VAULT_ADDR}/v1/transit/keys/trip-${tripId}`, { headers: { "X-Vault-Token": VAULT_TOKEN } });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`vault -> ${res.status} ${await res.text()}`);
  return true;
}

/** True if Vault can still decrypt `ciphertext` under the trip's key. */
export async function vaultCanDecrypt(tripId: string, ciphertext: string): Promise<boolean> {
  const res = await fetch(`${VAULT_ADDR}/v1/transit/decrypt/trip-${tripId}`, {
    method: "POST",
    headers: { "X-Vault-Token": VAULT_TOKEN, "content-type": "application/json" },
    body: JSON.stringify({ ciphertext }),
  });
  return res.ok;
}
