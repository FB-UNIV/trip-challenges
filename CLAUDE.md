# Trip Challenges

PWA for photo-challenge school trips. Handles **minors' data under strict erasure** — read
`CONTEXT.md` (domain glossary) and `docs/adr/` before changing auth, storage, crypto or erasure.

## Commands

```bash
npm install                 # all workspaces
npm run typecheck           # tsc across workspaces
npm test                    # Vitest (api + shared), no infra needed — Vault/S3 are mocked
npm run build               # api → dist, web → static bundle + service worker
npm run dev:api             # builds @trip/shared, then Fastify on :3000 (tsx watch)
npm run dev:web             # builds @trip/shared, then Vite on :5173 (proxies /api → :3000)
docker compose -f docker-compose.dev.yml up -d   # Postgres, MinIO, Vault for local dev
```

CI (`.github/workflows/ci.yml`) runs typecheck → test → build + Docker builds. There is no
linter configured. `scripts/e2e.mjs` is a live-stack smoke test — see its header for usage.

## Git workflow

- Never commit or push to `main` — it isn't protected by GitHub (private repo on Free), so this is on us. Branch (`feat/…`, `fix/…`, `ci/…`, `docs/…`),
  push, open a PR with `gh pr create`.
- PRs are squash-merged; the **PR title** is the commit and must be a Conventional Commit.
  It sets the semver bump: `fix:` patch, `feat:` minor, `feat!:` major. `docs/ci/chore/…` don't release.
- Releases are cut by merging release-please's `chore(main): release …` PR — never tag by hand
  or edit `CHANGELOG.md` / `.release-please-manifest.json` manually.

## Layout

- `packages/shared` — zod schemas + types; single source of truth for api and web
- `packages/api` — Fastify, ESM (imports use explicit `.js` extensions); schema in `db/schema.sql`
- `packages/web` — React 18 + Vite PWA; no tests yet

## Notes

- The API fails fast on missing/invalid env vars (`src/env-schema.ts`); `.env.example` lists them.
- Never log or persist student PII outside the per-trip encrypted scope (ADR 0001).
- More detail: `docs/development.md`, `docs/deployment.md`, `docs/data-model.md`.
