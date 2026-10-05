# Trip Challenges

A PWA for photo-challenge school trips. Students complete a teacher's Challenges by
uploading photos (via QR), nominate their best, then vote **Tinder-style** to elect
winners. Because participants are minors, **all student data is provably erased** at
trip end (crypto-erasure — destroy the per-trip key and every copy, including backups,
becomes unreadable).

- Domain glossary → [`CONTEXT.md`](./CONTEXT.md)
- Architecture decisions → [`docs/adr/`](./docs/adr)
- Database schema → [`docs/data-model.md`](./docs/data-model.md)
- **Deploy to production** → [`docs/deployment.md`](./docs/deployment.md) · then [`docs/production-hardening.md`](./docs/production-hardening.md)
- **Set up a dev environment** → [`docs/development.md`](./docs/development.md)

## How it works

```
draft ──▶ challenge ──▶ voting ──▶ reveal ──▶ grace ──▶ erased
 teams     upload +      pairwise    ceremony   keepsake   crypto-erase
 form      nominate      duels       reveal     results    (key destroyed)
```

Teacher signs in (OIDC), creates a Trip, imports a roster (students get emailed access
codes), and adds Challenges (each prints a QR). Students form teams, upload/nominate,
then vote. The teacher moderates, advances phases, and reveals results. Erasure fires
automatically after a grace window (or a hard deadline), or on demand.

## Components

| Component | Role | Notes |
|---|---|---|
| **PWA** (React + Vite) | student + teacher UI | installable, camera/QR |
| **API** (Fastify + TS) | all business logic | port 3000 |
| **Postgres** | relational data, tenant-scoped by `trip_id` | |
| **Object store** | encrypted photo blobs (S3 API) | MinIO bundled; or AWS S3 / R2 / B2 |
| **Vault** | per-Trip encryption keys (transit) | the erasure mechanism |
| **ClamAV** | scans every upload (fail-closed) | bundled; `AV_SCAN_ENABLED` |
| **PocketID** | teacher auth (OIDC) | *you provide* |
| **SMTP relay** | emails access codes + warnings | *you provide* |
| **Traefik** | TLS edge + security headers | *you provide (existing)* |

---

## Install — for operators (self-hosted deployment)

> 📘 This is the quickstart. The **full guide** — external S3, single-box IP deploy, TLS,
> upgrades, verification — is [`docs/deployment.md`](./docs/deployment.md).

### Required components

Before you start, have these ready:

1. **A Linux host** with **Docker** (Engine 24+) and **Docker Compose v2**.
2. **A public hostname** (e.g. `challenges.yourschool.org`) with a DNS record pointing
   at your **Traefik** edge.
3. **Traefik** running on your edge VPS (file provider — see step 5).
4. A **private link** (WireGuard/VPN) between the Traefik edge and this app host.
5. A **PocketID** (or any OIDC) instance for teacher login.
6. An **SMTP** server/relay to send emails.

### Steps

```bash
git clone <your-repo> trip-challenges && cd trip-challenges
cp .env.example .env
```

**1. Fill in `.env`** — in particular:

- `APP_HOST` — your public hostname · `PUBLIC_BASE_URL=https://<APP_HOST>`
- `APP_BIND_ADDR` — this host's **WireGuard/VPN IP** (never `0.0.0.0`)
- `POSTGRES_PASSWORD`, `S3_*` (storage creds/bucket), `SESSION_SECRET` (64 random bytes)
- `VAULT_*` — for production, do **not** use dev mode (see security note)
- `OIDC_*` — from your PocketID client (redirect `https://<APP_HOST>/api/auth/teacher/callback`)
- `SMTP_*` — your mail relay

**2. Register the OIDC client** in PocketID with the redirect URI above.

**3. Build and start the app host:**

```bash
docker compose build
docker compose up -d
```

This runs `web` + `api` (bound to `APP_BIND_ADDR`) and `postgres` + `minio` + `vault`
on a private network. The DB schema loads automatically on first boot.

**4. Configure the Traefik edge.** Copy [`traefik/dynamic.yml`](./traefik/dynamic.yml)
to your Traefik VPS (file provider), replacing `APP_BACKEND_HOST` with this host's VPN
IP. Traefik terminates TLS and adds HSTS/CSP/security headers.

**5. Verify:**

```bash
curl -s https://<APP_HOST>/api/healthz     # {"status":"ok"}
```

Open `https://<APP_HOST>/teacher` and sign in with PocketID.

> ⚠️ **Before real data, harden the deployment** →
> [`docs/production-hardening.md`](./docs/production-hardening.md). The bundled Vault runs in
> **dev mode** (in-memory, auto-unsealed, root token) — fine for evaluation, **not** for real
> minors' data. The runbook walks through persistent storage + real seal, a scoped API token
> (not root), and the backup rule that makes crypto-erasure real: keep Vault's storage **out
> of the database backup set** (see
> [ADR-0001](./docs/adr/0001-crypto-erasure-with-vault-per-trip-keys.md)).

---

## Install — for developers (local environment)

> 📘 This is the quickstart. The **full guide** — phone/QR testing, dev teacher login,
> exercising the student flow, troubleshooting — is [`docs/development.md`](./docs/development.md).

### Required environment

- **Node.js ≥ 20** and **npm ≥ 10**
- **Docker + Compose v2** (for the data services only)

### Steps

```bash
git clone <your-repo> trip-challenges && cd trip-challenges
npm install
```

**1. Start the data services** (Postgres, MinIO, Vault — published to `localhost`):

```bash
docker compose -f docker-compose.dev.yml up -d
```

**2. Create `.env`** for local dev — copy `.env.example` and point hosts at localhost:

```
POSTGRES_HOST=localhost
S3_ENDPOINT=http://localhost:9000
VAULT_ADDR=http://localhost:8200
PUBLIC_BASE_URL=http://localhost:5173
SESSION_SECRET=dev-secret-please-change-32chars-min
# OIDC_* — only needed to test teacher login (point at a dev PocketID)
```

**3. Run the API and the PWA** (two terminals):

```bash
npm run dev:api      # Fastify on :3000
npm run dev:web      # Vite on :5173 (proxies /api → :3000)
```

Open http://localhost:5173. The **student flow works without OIDC**; **teacher login**
needs a reachable PocketID (`OIDC_*`). To exercise the student flow, import a roster as a
teacher (or seed the DB) to generate access codes — in dev, emails are printed to the API
console instead of sent.

### Checks

```bash
npm test           # unit tests (Vitest) — no infra needed
npm run typecheck  # tsc across all workspaces
npm run build      # api → dist, web → static bundle + service worker
```

### Layout

```
packages/
  shared/   zod schemas + types (single source of truth for api + web)
  api/      Fastify service · db/schema.sql · Vault/S3 clients · erasure · test/
  web/      React PWA (student + teacher)
docs/       adr/ · data-model.md
traefik/    dynamic.yml (edge file-provider config)
```

---

## Testing

`npm test` runs the Vitest suite (39 tests, no infrastructure required):

- **shared** — schema defaults/validation (`TripConfig`, `ChallengeInput`, …)
- **api/wilson** — Wilson lower-bound ranking properties (ADR-0002)
- **api/pairToken** — duel token sign/verify, tamper + voter-binding
- **api/envelope** — AES-GCM seal/open round-trip + auth-tag tamper detection (Vault mocked)
- **api/env-schema** — env parsing/defaults (pure, split from config for testability)
- **api/avscan** — clamd INSTREAM framing + reply parsing (`OK` / `FOUND` / error)
- **api/erasureWarning** — upcoming-erasure warning bracket selection

### End-to-end (full stack)

[`scripts/e2e.mjs`](./scripts/e2e.mjs) drives real HTTP flows against a running stack and
asserts behaviour (40 checks) — with emphasis on reveal gating, access-code re-issue, tie
handling, config editing, and duel pair-exclusion. It recovers student access codes by
scraping the dev mailer output, so it needs `NODE_ENV=development`.

```bash
docker compose -f docker-compose.dev.yml up -d          # Postgres + MinIO + Vault
npx tsx --env-file=.env packages/api/src/server.ts > /tmp/api.log 2>&1 &   # API (dev)
E2E_BASE=http://localhost:3100 E2E_LOG=/tmp/api.log node scripts/e2e.mjs
```

Point `E2E_BASE`/`E2E_LOG` at wherever your dev API listens and logs. Exits non-zero on the
first failed assertion.

## CI/CD (Forgejo Actions)

Workflows live in [`.forgejo/workflows/`](./.forgejo/workflows):

- **`ci.yml`** — on push to `main` and every PR: `npm ci` → typecheck → test → build.
- **`release.yml`** — on a version tag (`v*`): builds and pushes the `trip-api` and
  `trip-web` Docker images to your Forgejo registry, then creates a Forgejo release.

Cut a release:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Configure once in **Settings ▸ Actions** (Variables & Secrets):

| Key | Type | Purpose |
|---|---|---|
| `REGISTRY` | variable | registry host, e.g. `forge.example.org` |
| `REGISTRY_TOKEN` | secret | token with `package:write` for the pushing user |
| `RELEASE_TOKEN` | secret | token with `repo:write` (creates the release) |

Images are tagged `…/trip-api:<version>`, `:<major>.<minor>` and `:latest`. Deploy them
by setting `IMAGE_API` / `IMAGE_WEB` in `.env` and running `docker compose pull && up -d`.
The runner must have Docker (buildx) and be able to fetch the referenced actions.

## Erasure

Fires automatically after voting + a grace window, on a hard deadline
(`tripEnd + retention`), or on demand by a teacher. It deletes photos, PII rows and logs,
then **destroys the Trip's Vault key** so any residual backup copy is permanently
unreadable. Non-PII results and a PII-free audit log survive. See
[`packages/api/src/erasure.ts`](./packages/api/src/erasure.ts) and
[ADR-0001](./docs/adr/0001-crypto-erasure-with-vault-per-trip-keys.md).

## Status

Core flow is implemented end to end: teacher OIDC login, trip creation with per-trip
Vault key, background roster import + emailed access codes, device-bound student
sessions, teams, QR upload with fail-closed AV scan + EXIF strip + envelope encryption,
nomination + teacher moderation, pairwise duels with Wilson ranking, results computation,
projector reveal ceremony, co-teacher invite/accept, automatic + on-demand erasure with
crypto-erasure and escalating pre-erasure warning emails.

**Remaining work** (decisions recorded in `CONTEXT.md` / `docs/data-model.md`):

| # | Item | Status |
|---|---|---|
| 1 | **Reveal gating** — public `GET /:id/results` is ungated during `reveal`, so phones can read the leaderboard before the ceremony reaches it. Gate by phase (`grace`+); ceremony reads via a teacher-authed path. | to build |
| 2 | **Lost-device access-code re-issue** — `POST /reissue`: trip-scoped email request, fresh code, old session revoked on redeem of the new code. | to build |
| 3 | **Tie handling** — per-challenge ties share placement + points; a Grand Champion tie gets an explicit teacher override. | to build |
| 4 | **Config editing** — `PATCH` trip/challenge + challenge add/delete, phase-gated (see the [editability matrix](./docs/data-model.md#editability-config-edits-via-patch)). | to build |
| 5 | **Duel pair exclusion** — `/next` should skip pairs the voter already cast (today the cast-time unique constraint catches them as a `409`). | to build |
| 6 | **E2E tests** · **production Vault hardening** ([runbook](./docs/production-hardening.md)) · **SMTP relay log retention** (operator task) | ongoing / ops |

Backend logic, crypto and erasure are solid; the remaining items are edges — recovery,
reveal enforcement, tie-breaks, and post-creation editing. See git history / the ADRs for
decisions.
