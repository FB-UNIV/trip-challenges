// Vault transit client — the per-Trip crypto keystore (ADR-0001).
// One transit key per Trip ("trip-<id>"). All student PII + photo bytes are
// encrypted under it. Erasure = deleteKey() -> every ciphertext (incl. backups)
// is permanently unreadable.
import { randomUUID } from "node:crypto";
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

/**
 * Startup self-check (#69): run a throwaway trip key through every operation the app performs,
 * erasure's destroy included, so a token missing a policy line fails the boot with the line to
 * add, instead of failing a teacher's request (or an erasure) later. The probe key is a
 * `trip-*` key on purpose: it must pass through the same policy paths a real trip's does.
 */
export async function probeKeystore(): Promise<void> {
  const probe = `selfcheck-${randomUUID()}`;
  const m = config.VAULT_TRANSIT_MOUNT;
  const step = async (what: string, capability: string, path: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e: any) {
      const status = typeof e?.status === "number" ? e.status : null;
      throw new Error(
        `keystore self-check: could not ${what} (${status ? `vault ${status}` : "Vault unreachable"}). ` +
          (status === 403
            ? `The Vault token needs "${capability}" on ${path} (see docs/production-hardening.md §1b).`
            : `Check that VAULT_ADDR is right and that Vault is up and unsealed.`),
      );
    }
  };
  await step("create a key", "create", `${m}/keys/trip-*`, () => createTripKey(probe));
  try {
    let ciphertext = "";
    await step("encrypt", "update", `${m}/encrypt/trip-*`, async () => {
      ciphertext = await encrypt(probe, Buffer.from("selfcheck"));
    });
    await step("decrypt", "update", `${m}/decrypt/trip-*`, async () => {
      if ((await decrypt(probe, ciphertext)).toString() !== "selfcheck") throw new Error("round trip mismatch");
    });
    await step("compute an HMAC", "update", `${m}/hmac/trip-*`, () => hmac(probe, Buffer.from("selfcheck")));
    await step("issue a data key", "update", `${m}/datakey/plaintext/trip-*`, () => dataKey(probe));
    await step("destroy a key (allow deletion)", "update", `${m}/keys/trip-*/config`, () =>
      vault(`${m}/keys/${keyName(probe)}/config`, { deletion_allowed: true }));
    await step("destroy a key", "delete", `${m}/keys/trip-*`, () =>
      vault(`${m}/keys/${keyName(probe)}`, undefined, "DELETE"));
  } catch (e) {
    await destroyTripKey(probe).catch(() => {}); // don't leave the probe key behind
    throw e;
  }
}

/** Readiness: Vault's own health. A standby (429 with standbyok) can still serve via forwarding. */
export async function keystoreHealth(): Promise<"ok" | "sealed" | "down"> {
  try {
    const res = await fetch(`${config.VAULT_ADDR}/v1/sys/health?standbyok=true`, { signal: AbortSignal.timeout(2000) });
    if (res.ok || res.status === 429) return "ok";
    return res.status === 503 ? "sealed" : "down";
  } catch {
    return "down";
  }
}
