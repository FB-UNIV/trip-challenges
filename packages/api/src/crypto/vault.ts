// Vault transit client — the per-Trip crypto keystore (ADR-0001).
// One transit key per Trip ("trip-<id>"). All student PII + photo bytes are
// encrypted under it. Erasure = deleteKey() -> every ciphertext (incl. backups)
// is permanently unreadable.
import { config } from "../config.js";
import { tagDependency } from "../lib/errors.js";

const base = `${config.VAULT_ADDR}/v1/${config.VAULT_TRANSIT_MOUNT}`;

// Errors are tagged "keystore" so the API answers 503 keystore_unavailable on an outage (#69).
async function vault(path: string, body?: unknown, method = "POST") {
  const res = await fetch(`${config.VAULT_ADDR}/v1/${path}`, {
    method,
    headers: {
      "X-Vault-Token": config.VAULT_TOKEN,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  }).catch((e: unknown) => { throw tagDependency(e, "keystore"); });
  if (!res.ok) {
    throw tagDependency(
      Object.assign(new Error(`vault ${path} -> ${res.status} ${await res.text()}`), { status: res.status }),
      "keystore",
    );
  }
  return res.status === 204 ? {} : ((await res.json()) as any);
}

export const keyName = (tripId: string) => `trip-${tripId}`;

/** Enable the transit secrets engine if it isn't already (idempotent, boot-time). */
export async function ensureTransitEngine(): Promise<void> {
  const res = await fetch(`${config.VAULT_ADDR}/v1/sys/mounts/${config.VAULT_TRANSIT_MOUNT}`, {
    method: "POST",
    headers: { "X-Vault-Token": config.VAULT_TOKEN, "content-type": "application/json" },
    body: JSON.stringify({ type: "transit" }),
  });
  // 204 = enabled now; 400 = already mounted ("path is already in use").
  if (!res.ok && res.status !== 400) {
    throw new Error(`vault enable transit -> ${res.status} ${await res.text()}`);
  }
}

/** Create the Trip's transit key. Called when a Trip is created. */
export async function createTripKey(tripId: string): Promise<void> {
  await vault(`${config.VAULT_TRANSIT_MOUNT}/keys/${keyName(tripId)}`, {
    type: "aes256-gcm96",
  });
}

/** Encrypt a small field (email, team name). Returns "vault:v1:..." ciphertext. */
export async function encrypt(tripId: string, plaintext: Buffer): Promise<string> {
  const out = await vault(`${config.VAULT_TRANSIT_MOUNT}/encrypt/${keyName(tripId)}`, {
    plaintext: plaintext.toString("base64"),
  });
  return out.data.ciphertext;
}

export async function decrypt(tripId: string, ciphertext: string): Promise<Buffer> {
  const out = await vault(`${config.VAULT_TRANSIT_MOUNT}/decrypt/${keyName(tripId)}`, {
    ciphertext,
  });
  return Buffer.from(out.data.plaintext, "base64");
}

/** Trip-scoped HMAC for blind lookup/dedupe (email_lookup). Dies with the key. */
export async function hmac(tripId: string, input: Buffer): Promise<string> {
  const out = await vault(`${config.VAULT_TRANSIT_MOUNT}/hmac/${keyName(tripId)}/sha2-256`, {
    input: input.toString("base64"),
  });
  return out.data.hmac;
}

/**
 * Envelope key for a photo blob: Vault returns a fresh DEK (plaintext + wrapped).
 * Encrypt the bytes locally with `plaintext`, store `ciphertext` (wrapped) next to
 * the object, discard the plaintext. Unwrap later via decrypt().
 */
export async function dataKey(
  tripId: string,
): Promise<{ plaintext: Buffer; wrapped: string }> {
  const out = await vault(
    `${config.VAULT_TRANSIT_MOUNT}/datakey/plaintext/${keyName(tripId)}`,
  );
  return {
    plaintext: Buffer.from(out.data.plaintext, "base64"),
    wrapped: out.data.ciphertext,
  };
}

/**
 * THE erasure primitive. Allows deletion, then destroys the Trip's key.
 * After this, no 🔒 value for the Trip is recoverable, anywhere.
 */
export async function destroyTripKey(tripId: string): Promise<void> {
  try {
    await vault(`${config.VAULT_TRANSIT_MOUNT}/keys/${keyName(tripId)}/config`, {
      deletion_allowed: true,
    });
    await vault(`${config.VAULT_TRANSIT_MOUNT}/keys/${keyName(tripId)}`, undefined, "DELETE");
  } catch (e: any) {
    // Already gone (e.g. a retried erasure that failed after this step): job done.
    if (e?.status === 404) return;
    throw e;
  }
}
