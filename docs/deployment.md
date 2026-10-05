# Deployment guide (production)

How to stand up Trip Challenges for real use. This is the "make it run" guide; once it
runs, work through [`production-hardening.md`](./production-hardening.md) before it holds
real minors' data — that covers Vault, backups, and the erasure guarantee.

- **Architecture** → [ADR-0003](./adr/0003-self-hosted-docker-compose-over-managed-ha.md)
- **Env reference** → [`.env.example`](../.env.example) (every variable, with inline notes)
- **Dev environment** → [`development.md`](./development.md)

---

## 1. What runs

`docker-compose.yml` brings up six services on a private bridge network:

| Service | Image | Exposed? | Purpose |
|---|---|---|---|
| `web` | `trip-web` (nginx) | `${APP_BIND_ADDR}:8080 → 80` | static PWA bundle |
| `api` | `trip-api` (Fastify) | `${APP_BIND_ADDR}:3000 → 3000` | all business logic; listens `0.0.0.0:3000` in-container |
| `postgres` | `postgres:16` | internal only | relational data (ciphertext PII) |
| `minio` | `minio` | internal only | object store — **optional** (see §4) |
| `vault` | `hashicorp/vault` | internal only | per-Trip crypto keys (the erasure mechanism) |
| `clamav` | `clamav/clamav` | internal only | uploads scanned before storage |

`web` and `api` bind to `APP_BIND_ADDR` (default `127.0.0.1`) — **not** the public
internet. Something in front terminates TLS and routes to them. Two supported shapes:

- **A — Separate edge** (the design intent): a Traefik/nginx/Caddy box reaches this host
  over a private link (WireGuard). See §3A.
- **B — Single box on an IP**: a reverse proxy on the *same* host publishes one HTTPS port
  on the server's IP. See §3B. **This is the path if you just want "publish to an IP".**

You need **one origin** serving both the SPA (`/`) and the API (`/api`) — the app uses
same-origin, `SameSite=strict` cookies, so splitting them across origins breaks sessions.

---

## 2. Prerequisites

1. A Linux host with **Docker Engine 24+** and **Compose v2**.
2. **Object storage** — either use the bundled MinIO, or an external S3 bucket (AWS S3,
   Cloudflare R2, Backblaze B2). See §4.
3. **Vault** — the bundled dev-mode Vault boots instantly for evaluation; for real data
   you must move it to production mode first ([hardening §1](./production-hardening.md#1-vault-out-of-dev-mode)).
4. A **PocketID** (or any OIDC provider) instance for teacher login. Students do **not**
   need OIDC — they authenticate with emailed access codes.
5. An **SMTP** relay to email access codes + erasure warnings. (Without it, the app still
   runs but can't deliver codes — fine for a smoke test, not for real use.)
6. **TLS.** Teacher login uses an OIDC transaction cookie that is always `Secure`, so the
   teacher admin **requires HTTPS**. Plan for a certificate (real, or Caddy's internal CA).

---

## 3. Configure and start

```bash
git clone <your-repo> trip-challenges && cd trip-challenges
cp .env.example .env
```

Edit `.env` — the variables that matter most:

| Variable | Set to |
|---|---|
| `NODE_ENV` | `production` (enables Secure cookies; **disables** the dev-login backdoor) |
| `PUBLIC_BASE_URL` | the public URL users hit, e.g. `https://challenges.example.org` or `https://203.0.113.10` — QR codes embed this |
| `APP_BIND_ADDR` | address `web`/`api` bind to. Edge model: this host's WireGuard IP. Single-box: `127.0.0.1` (proxy reaches them locally) |
| `SESSION_SECRET` | 64 random bytes (`openssl rand -hex 32`) |
| `POSTGRES_PASSWORD` | strong random |
| `S3_*` | storage — see §4 |
| `VAULT_ADDR` / `VAULT_TOKEN` | dev token for eval; AppRole for prod (hardening §1b) |
| `OIDC_*` | from your PocketID client; redirect URI must be `PUBLIC_BASE_URL` + `/api/auth/teacher/callback` |
| `SMTP_*` | your mail relay |
| `AV_SCAN_ENABLED` | `true` (uploads fail-closed if clamd is down) |

Register the OIDC client in PocketID with redirect URI
`<PUBLIC_BASE_URL>/api/auth/teacher/callback`.

Build and start:

```bash
docker compose build
docker compose up -d
```

The API applies the Postgres schema itself at boot: numbered SQL files in `packages/api/db/migrations/`, each in a transaction, recorded in `schema_migrations`, under an advisory lock so replicas don't race. A database created by the old `schema.sql` init script is adopted at `0001_baseline` automatically. To change the schema, add the next numbered file; never edit one that has shipped.
clamav downloads signature databases on first boot (~1–2 min); the `api` waits for it.

### 3A. Edge model (separate Traefik VPS)

Set `APP_BIND_ADDR` to this host's WireGuard IP. Copy [`traefik/dynamic.yml`](../traefik/dynamic.yml)
to your Traefik VPS (file provider), replacing `APP_BACKEND_HOST` with that IP. Traefik
terminates TLS and adds HSTS/CSP/security headers. For HA, run a second app host and list
both backends — Traefik load-balances and health-checks.

### 3B. Single box on an IP (reverse proxy on the same host)

Keep `APP_BIND_ADDR=127.0.0.1`. Put a reverse proxy on the host that listens on the public
IP and routes `/` → `web:8080` and `/api` → `api:3000` **on one origin**. Caddy is the
least fuss and gives you HTTPS on an IP via its internal CA:

```
# Caddyfile — replace 203.0.113.10 with your server's IP (or a hostname)
https://203.0.113.10 {
    tls internal                      # self-signed; or use a real cert / your domain
    handle /api/* {
        reverse_proxy 127.0.0.1:3000
    }
    handle {
        reverse_proxy 127.0.0.1:8080
    }
}
```

```bash
# quickest: run Caddy in a container sharing the host network
docker run -d --name tc-edge --network host \
  -v "$PWD/Caddyfile:/etc/caddy/Caddyfile" \
  -v caddy_data:/data caddy:2
```

Then set `PUBLIC_BASE_URL=https://203.0.113.10` and re-run `docker compose up -d`.

> ⚠️ **Why HTTPS even on an IP.** Session cookies are `Secure` when `NODE_ENV=production`,
> and the teacher OIDC login cookie is `Secure` **always**. Over plain `http://<IP>` the
> browser silently drops those cookies → **teacher login and student sessions won't work.**
> Options, best first: (1) HTTPS via Caddy `tls internal` (accept the cert warning) or a
> real cert; (2) put it behind a domain with Let's Encrypt. Running `NODE_ENV=development`
> to dodge the cookie flag is **not** an option in production — it re-enables `/dev-login`,
> a passwordless teacher backdoor.

---

## 4. Object storage — bundled MinIO or external S3

The API speaks the S3 protocol; the store is chosen entirely by `S3_*` env vars. Photo
bytes are envelope-encrypted before upload, so the store only ever holds ciphertext.

**Bundled MinIO (default).** Keep the `minio` service; point the API at it:

```
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=trip-minio
S3_SECRET_ACCESS_KEY=<same as MINIO_ROOT_PASSWORD>
S3_BUCKET=submissions
S3_FORCE_PATH_STYLE=true
MINIO_ROOT_USER=trip-minio          # the minio server's own creds
MINIO_ROOT_PASSWORD=<strong random>
```

**External S3 (AWS / R2 / B2).** Point `S3_*` at the provider and **remove the bundled
MinIO** to save resources — delete the `minio` service block, the `minio_data` volume, and
the `minio:` line under the api's `depends_on:` in `docker-compose.yml`. Then:

```
# AWS S3 (pre-create the bucket; omit S3_ENDPOINT)
S3_REGION=eu-west-1
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=...
S3_BUCKET=trip-challenges-prod
S3_FORCE_PATH_STYLE=false

# Cloudflare R2
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY_ID=<r2 key id>
S3_SECRET_ACCESS_KEY=<r2 secret>
S3_BUCKET=trip-challenges
S3_FORCE_PATH_STYLE=false
```

On boot the API ensures the bucket exists; if its credentials can't create buckets (typical
on AWS/R2), pre-create the bucket and the app logs a clear message rather than failing
cryptically. Grant the app credential `Get/Put/List/DeleteObject` on the bucket —
`DeleteObject` is required so erasure can sweep a trip's blobs.

---

## 5. Verify

```bash
curl -s http://127.0.0.1:3000/api/healthz          # {"status":"ok"} (direct)
curl -sk https://<PUBLIC_HOST>/api/healthz          # via the edge/proxy
```

- Open `https://<PUBLIC_HOST>/teacher` and sign in with PocketID.
- Confirm the dev backdoor is off in prod: `curl -s https://<host>/api/auth/teacher/dev-login`
  must **not** log you in (route is unregistered when `NODE_ENV=production`).
- Create a trip, import a one-line roster, confirm an access-code email is delivered.
- Upload a photo; confirm it's scanned and stored (see `docker compose logs api`).

---

## 6. Operate

- **Logs:** `docker compose logs -f api`. No student PII is ever logged (design invariant);
  ship logs to your aggregator, but keep them **off** the Vault storage medium.
- **Upgrades:** pull/build new images, `docker compose up -d`. The API applies any pending
  schema migrations at boot before serving (watch for `schema migrations applied` in the
  logs). A failing migration is rolled back and the API exits, so the old release keeps
  the database untouched; take a Postgres backup before upgrading anyway.
- **Backups & erasure:** back up Postgres + object store together; back up Vault storage
  **separately and tightly** — this separation is what makes crypto-erasure real. Full rules
  in [hardening §2](./production-hardening.md#2-backups-and-the-erasure-guarantee).
- **Break-glass erase:** teacher "Erase now", or destroy a trip's Vault key by hand — see
  [hardening §6](./production-hardening.md#6-break-glass-erase-on-demand).

---

## 7. CI/CD (GitHub Actions)

Workflows in [`.github/workflows/`](../.github/workflows): `ci.yml` runs typecheck → test
→ build (and a Docker build) on every PR/push; `release.yml` uses release-please to cut
semver releases and pushes `trip-api` + `trip-web` images to GHCR. Then set
`IMAGE_API`/`IMAGE_WEB` in `.env` to the pushed tags (e.g. `ghcr.io/<owner>/trip-api:0.1.0`),
`docker login ghcr.io` on the host (the images are private), and `docker compose up -d` to
deploy the built images instead of building on the host. See the README's CI/CD section.
