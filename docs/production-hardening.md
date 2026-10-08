# Production hardening runbook

The bundled `docker-compose.yml` boots for **evaluation**. Before it holds real minors'
data, work through this checklist. The load-bearing part is **Vault** — the crypto-erasure
guarantee (ADR-0001) is only as real as Vault's production configuration. Everything else
here is standard hygiene.

> The one rule that makes erasure real: **Vault's storage must never be in the same backup
> set as Postgres/MinIO.** If a photo ciphertext and the key that unwraps it are restorable
> from the same backup, destroying the live key erases nothing. Keep them on separate media
> with separate retention. See [§2](#2-backups-and-the-erasure-guarantee).

---

## 1. Vault out of dev mode

The dev container runs `vault server -dev`: in-memory storage, auto-unsealed, a fixed root
token. Losing the container loses every key (all trips instantly "erased"); the root token
in `.env` can do anything. Replace all three properties.

The API only needs `VAULT_ADDR`, `VAULT_TOKEN`, and `VAULT_TRANSIT_MOUNT` (default
`transit`). It performs transit `encrypt`/`decrypt`/`hmac`/`datakey`, creates a key per
trip, and — for erasure — sets `deletion_allowed` then `DELETE`s the key. The policy below
grants exactly that and nothing else.

### 1a. Persistent storage + real seal

Replace the dev container with a configured server. Minimal `vault.hcl`:

```hcl
storage "raft" {
  path    = "/vault/data"
  node_id = "vault-1"
}

listener "tcp" {
  address       = "0.0.0.0:8200"
  tls_cert_file = "/vault/tls/cert.pem"
  tls_key_file  = "/vault/tls/key.pem"
}

# Auto-unseal so a restart doesn't need a human. Pick ONE backend your org already runs
# (cloud KMS, HSM, or Transit from a *separate* Vault). Without it, every restart blocks
# on `vault operator unseal`.
seal "awskms" {
  region     = "eu-west-1"
  kms_key_id = "..."
}
```

Mount `/vault/data` and `/vault/tls` as real volumes. TLS is mandatory — the API sends the
token and plaintext DEKs over this socket.

Initialize **once**:

```bash
vault operator init -key-shares=5 -key-threshold=3
```

Store the unseal/recovery keys and the initial root token **offline, split across people**.
You will not use the root token for day-to-day operation — it exists to bootstrap and to
break glass.

### 1b. A scoped token for the API (not root)

Write the policy the API actually needs:

```hcl
# transit-app.hcl  — mount path is VAULT_TRANSIT_MOUNT (default "transit")
path "transit/keys/trip-*"          { capabilities = ["create", "read", "update"] }
path "transit/keys/trip-*/config"   { capabilities = ["update"] }              # deletion_allowed
path "transit/keys/trip-*"          { capabilities = ["delete"] }              # THE erasure delete
path "transit/encrypt/trip-*"       { capabilities = ["update"] }
path "transit/decrypt/trip-*"       { capabilities = ["update"] }
path "transit/hmac/trip-*"          { capabilities = ["update"] }
path "transit/datakey/plaintext/trip-*" { capabilities = ["update"] }
path "sys/mounts/transit"           { capabilities = ["create", "read", "update"] } # boot-time ensureTransitEngine
```

```bash
vault policy write transit-app transit-app.hcl
```

Prefer **AppRole** over a hand-minted token so the credential is rotatable:

```bash
vault auth enable approle
vault write auth/approle/role/trip-api \
  token_policies=transit-app token_ttl=1h token_max_ttl=4h secret_id_ttl=24h
vault read  auth/approle/role/trip-api/role-id           # -> VAULT_ROLE_ID
vault write -f auth/approle/role/trip-api/secret-id       # -> VAULT_SECRET_ID
```

The API today reads a static `VAULT_TOKEN`. Two supported patterns:

- **Simple:** create a periodic token against the policy and put it in `VAULT_TOKEN`; renew
  it on a schedule (`vault token renew`) or rotate the `.env` value.
  ```bash
  vault token create -policy=transit-app -period=24h -orphan   # copy .auth.client_token
  ```
- **Recommended:** run [Vault Agent](https://developer.hashicorp.com/vault/docs/agent-and-proxy/agent)
  as a sidecar doing AppRole login + auto-renew, writing the token to a shared tmpfs the API
  reads as `VAULT_TOKEN`. This keeps the long-lived secret (role-id/secret-id) out of the app
  and gives you short-lived tokens.

Either way: **revoke the root token** once bootstrap is done
(`vault token revoke <root>`); regenerate via unseal keys only to break glass.

### 1c. Audit device

Turn on an audit log so key creation and — critically — key destruction are attributable:

```bash
vault audit enable file file_path=/vault/logs/audit.log
```

Transit ciphertext is not logged, but the HMAC of request bodies is. Ship these logs to your
existing aggregator; **do not** co-locate them with the Vault storage backup.

---

## 2. Backups and the erasure guarantee

| Store | Contains | Back up? | Restore erases-safety |
|---|---|---|---|
| **Postgres** | ciphertext PII, `email_lookup` HMACs, non-PII results | Yes | Safe — unreadable without the trip key |
| **MinIO** | envelope-encrypted photo blobs + wrapped DEKs | Yes | Safe — DEKs are wrapped by the trip key |
| **Vault storage** | the trip keys themselves | **Separately, tightly controlled** | **This is the erasure boundary** |

Rules:

1. Postgres and MinIO backups may share a pipeline. They contain **only ciphertext** — a
   stolen or stale backup is inert once the key is destroyed.
2. **Vault storage backups live elsewhere**, with their own short retention and access list.
   A Postgres backup from last week + a Vault backup from last week = full recovery of a trip
   you "erased." That is the failure mode this whole design exists to prevent.
3. After an erasure, a restored Postgres/MinIO backup that predates it will still hold the
   ciphertext rows — but they are **undecryptable**, because the key is gone from live Vault
   and (per rule 2) from any Vault backup you'd actually restore. That is the guarantee.

**Prove it in staging** before trusting it: create a trip, upload a photo, run erasure, then
restore yesterday's Postgres+MinIO backup and confirm the photo will not decrypt (the trip
key is absent). Document the result.

---

## 3. Secrets and network

- `SESSION_SECRET` — 64 random bytes, unique per deployment. Rotating it invalidates all
  teacher sessions (acceptable; they re-login via OIDC). Students keep device-bound sessions.
- `APP_BIND_ADDR` — bind the app to the **WireGuard/VPN IP**, never `0.0.0.0`. Postgres,
  MinIO, and Vault stay on the internal compose network with **no published ports** in
  production (the `docker-compose.dev.yml` port publishing is dev-only).
- TLS + security headers (HSTS, CSP) terminate at **Traefik** (`traefik/dynamic.yml`).
  Cookies are `Secure` only when `NODE_ENV=production` — so production **must** set it.
- `/api/auth/teacher/dev-login` is compiled to refuse unless `NODE_ENV !== "production"`.
  Confirm it 404/403s in prod (`curl` it as part of your smoke test).

---

## 4. Antivirus on uploads

Set `AV_SCAN_ENABLED=true` and run the bundled `clamav` service. Uploads are **fail-closed**:
if clamd is unreachable the API returns `503 scan_unavailable` rather than storing an unscanned
file. Two consequences:

- clamd must be healthy before the API accepts uploads. `depends_on: service_healthy` handles
  boot; monitor it thereafter — a dead clamd means no uploads.
- Signatures must stay fresh. The `clamav/clamav` image runs `freshclam`; ensure the
  `clamav_data` volume persists and the container has outbound access to the CVD mirrors (or
  a private mirror) so definitions update.

Verify end to end with the EICAR test string — a file containing
`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*` must be rejected `422`.

---

## 5. Log hygiene (recurring audit)

No student PII may reach logs. The code holds this line — the roster worker stores only an
error **code/name** on failure, never the address; audit rows reference IDs, not emails. When
you add code or change log statements, re-check: **no email, name, or access code in any log
or error string.** A leak here defeats erasure (logs outlive the key).

Enforced in code and tests (`packages/api/src/lib/logging.ts`, `test/logging.test.ts`):

- request URLs are logged **without their query string** (invite tokens, ids);
- `email` / `code` keys are redacted at any depth, plus cookies and `Authorization`;
- a failed access-code mail logs only the SMTP error **code**: SMTP errors echo the recipient;
- with `NODE_ENV=production` and no `SMTP_HOST`, the mailer **refuses** to send instead of
  falling back to printing the mail (which would log access codes).

### Errors and request ids (#69)

Every API error answers `{ error, message, requestId }`; the same id is in the `X-Request-Id`
response header and on every log line as `reqId`. The API reuses the edge's `X-Request-Id`
when it is short and plain (`[A-Za-z0-9._:-]`, at most 64 characters), otherwise it generates
a UUID. To enable it in Traefik, add the request-id plugin or a header middleware; without
one, ids start at the API.

**Tracing a user report:** the app shows "Reference: <id>". Search the API logs for
`"reqId":"<id>"`. The 5xx line has `route` (the pattern, e.g. `/api/trips/:id/erase`, never
the URL), `status`, `dependency` and `errorCode`.

| Response | Meaning | Look at |
|---|---|---|
| 503 `storage_unavailable` | S3/MinIO failed (network, `AccessDenied`, `NoSuchBucket`…) | `errorCode`, bucket policy, MinIO health |
| 503 `keystore_unavailable` | Vault unreachable, sealed, or refused the token (403) | `vault status`, token TTL/policy (§1) |
| 503 `database_unavailable` | Postgres refused or dropped the connection | Postgres health, connection limit |
| 500 `internal_error` | A bug: the client sees no detail | the log line's `err.stack` |

5xx are logged at `error`. 403 and 429 are logged at `warn` (probing, or a class hammering
the API). Other client errors are only in the normal request log. Error logs carry the error's
name, message, code and stack, but **not** the driver's raw error object: Postgres puts row
values in `detail`.

Because the app never logs PII, erasure has no log-scrubbing step: there is nothing app-side
to scrub. The one residual that erasure *cannot* reach is your
**external SMTP relay's delivery logs**: relays typically record recipient addresses, and the
app has no API into them. This is an **operator responsibility**:

- Configure the relay to **not** retain message/recipient logs beyond what you need, and rotate
  them on a schedule shorter than a trip's lifetime. A student address sitting in relay logs
  after that trip's key is destroyed is a residual-PII leak that defeats crypto-erasure.
- Prefer a relay you control (or one contractually bound as a sub-processor) over a third-party
  API whose retention you can't set.

---

## 6. Break-glass: erase on demand

Erasure normally fires automatically after the grace window (or a trip's hard deadline). To
force it immediately (incident, consent withdrawal, wrong upload):

- **Per trip, in-app:** teacher → trip admin → **Erase now** (double-confirmed). This runs the
  same `destroyTripKey` path.
- **Per trip, by hand** (app down): destroy the key directly — this is irreversible and
  immediately renders that trip's every ciphertext, everywhere, unreadable:
  ```bash
  vault write transit/keys/trip-<TRIP_ID>/config deletion_allowed=true
  vault delete transit/keys/trip-<TRIP_ID>
  ```
  Then drop the trip's rows (they are now inert ciphertext) at your convenience.
- **Whole-deployment break-glass:** destroying Vault's storage backend (and its offsite
  backup) erases **every** trip at once. Reserve for a compromise scenario.

After any erasure, confirm the key is gone (`vault read transit/keys/trip-<ID>` → 404) and
that the corresponding photos no longer decrypt.
