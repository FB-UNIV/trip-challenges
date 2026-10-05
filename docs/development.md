# Development guide

Set up a local environment to run and hack on Trip Challenges. The **student flow works
without any external services**; **teacher login** needs either an OIDC provider or the
built-in dev-login shortcut (below).

- Architecture & glossary → [`../CONTEXT.md`](../CONTEXT.md), [`adr/`](./adr)
- Production → [`deployment.md`](./deployment.md)

---

## 1. Prerequisites

- **Node.js ≥ 20** and **npm ≥ 10** (the API is ESM; imports use explicit `.js` extensions).
- **Docker + Compose v2** — for the data services only (Postgres, MinIO, Vault). The API
  and PWA run on your host with hot reload.

## 2. Install

```bash
git clone <your-repo> trip-challenges && cd trip-challenges
npm install          # installs all workspaces (@trip/shared, @trip/api, @trip/web)
```

## 3. Start the data services

`docker-compose.dev.yml` runs just the backing services, published to `localhost`:

```bash
docker compose -f docker-compose.dev.yml up -d
```

| Service | Host port | Notes |
|---|---|---|
| Postgres | `5432` | schema auto-loads on first boot |
| MinIO | `9000` (API), `9001` (web console) | default creds `trip-minio` / `devpass123` |
| Vault | `8200` | dev mode, root token `dev-root-token` |

Every port is overridable if it clashes with something you already run — e.g.
`MINIO_HOST_PORT=9002 MINIO_CONSOLE_PORT=9003 PG_HOST_PORT=5433 VAULT_HOST_PORT=8201 docker compose -f docker-compose.dev.yml up -d`.
Set the same values in your `.env` endpoints below.

## 4. Configure `.env`

Copy the example and point everything at `localhost`:

```bash
cp .env.example .env
```

Minimum for the student flow (no OIDC, no email, no AV):

```ini
NODE_ENV=development
API_PORT=3000
PUBLIC_BASE_URL=http://localhost:5173

POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=trip
POSTGRES_USER=trip
POSTGRES_PASSWORD=devpass

# Object storage → the bundled dev MinIO (S3 API, path-style)
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=trip-minio
S3_SECRET_ACCESS_KEY=devpass123
S3_BUCKET=submissions
S3_FORCE_PATH_STYLE=true

VAULT_ADDR=http://localhost:8200
VAULT_TOKEN=dev-root-token
VAULT_TRANSIT_MOUNT=transit

SESSION_SECRET=dev-secret-please-change-32chars-min   # ≥ 32 chars

AV_SCAN_ENABLED=false        # dev compose has no clamav; leave off

# OIDC_* — only to test real teacher login; skip if using dev-login (§6)
```

The API **fails fast** if a required variable is missing — that's intentional. If it exits
on boot, the error names the missing/invalid key.

## 5. Run the API and the PWA

Two terminals:

```bash
npm run dev:api      # Fastify on :3000 (tsx watch — restarts on save)
npm run dev:web      # Vite on :5173, proxies /api → :3000
```

Open **http://localhost:5173**. On first API boot it enables the Vault transit engine and
creates the MinIO bucket automatically.

### Testing from a phone (camera / QR)

`npm run dev:web` runs `vite --host`, so the dev server is reachable on your LAN at
`http://<your-machine-ip>:5173`. Open that on a phone on the same network to test the camera
and QR scanning. The `/api` proxy runs on the dev host, so the API doesn't need separate
exposure. (Raw IP works out of the box; a hostname additionally needs `server.allowedHosts`
in `vite.config.ts`.)

## 6. Signing in as a teacher (without OIDC)

When `NODE_ENV !== "production"` the API exposes a passwordless shortcut — a dev-only
backdoor that is **not registered in production**:

```bash
curl -c cookies.txt -X POST http://localhost:3000/api/auth/teacher/dev-login \
  -H 'content-type: application/json' -d '{"email":"teacher@example.org"}'
```

That sets a teacher session cookie. In the browser, the teacher UI at `/teacher` will then
work. To exercise the **real** OIDC flow instead, point `OIDC_*` at a dev PocketID and set
`OIDC_REDIRECT_URI=http://localhost:5173/api/auth/teacher/callback`.

## 7. Exercising the student flow

1. As a teacher, create a trip and import a roster (one email per line).
2. Access codes are **printed to the API console** in dev (SMTP unset) — look for a
   `[mail:dev] to=… :: … code=…` line.
3. Redeem by opening `http://localhost:5173/join?code=<the-code>` — that spends the code and
   establishes a device session. From there: form a team, upload via a challenge QR, vote.

## 8. Checks

```bash
npm test           # Vitest — 39 tests, no infrastructure required
npm run typecheck  # tsc across all workspaces
npm run build      # api → dist, web → static bundle + service worker
```

For end-to-end work against live services, keep the dev compose up and drive the API with
`curl` (see the `verify`/E2E scripts pattern). Tests themselves mock Vault/S3 and need no
infra.

## 9. Layout

```
packages/
  shared/   zod schemas + types — the single source of truth for api + web
  api/      Fastify service
    src/routes/     HTTP endpoints (trips, roster, teams, submissions, duels, invites, …)
    src/crypto/     Vault transit + envelope encryption
    src/storage/    s3.ts — S3-compatible object store (MinIO/AWS/R2/B2)
    src/erasure.ts  the crypto-erasure job + upcoming-erasure warnings
    src/scheduler.ts background ticks (erasure, warnings, roster drain) under advisory locks
    db/schema.sql   loaded on first Postgres boot
    test/           Vitest unit tests
  web/      React PWA (Vite) — student + teacher UI, inline styles + index.css
docs/       adr/ · data-model.md · deployment.md · development.md · production-hardening.md
traefik/    dynamic.yml (edge file-provider config)
```

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| API exits immediately on boot | A required env var is missing/invalid — the error names it. |
| `ECONNREFUSED` to Postgres/MinIO/Vault | Data services not up, or a port was remapped. `docker compose -f docker-compose.dev.yml ps`; align `.env` endpoints with any `*_HOST_PORT` overrides. |
| Port already in use on `up` | Another local stack owns 5432/9000/8200. Re-run with `PG_HOST_PORT=…`, `MINIO_HOST_PORT=…`, `VAULT_HOST_PORT=…`. |
| Teacher login redirect fails | `OIDC_REDIRECT_URI` must exactly match the client's registered URI and end in `/api/auth/teacher/callback`. Or just use dev-login (§6). |
| No access-code email | Expected in dev — codes print to the API console. Set `SMTP_*` to send for real. |
| Uploads rejected `503 scan_unavailable` | `AV_SCAN_ENABLED=true` but no clamd reachable. Set it `false` in dev, or run a clamav container. |
| Vault errors after `docker compose down -v` | Dev Vault is in-memory; wiping volumes destroys all keys (every trip becomes unreadable). Expected — recreate trips. |
