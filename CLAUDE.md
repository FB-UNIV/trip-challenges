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

CI (`.forgejo/workflows/ci.yml`) runs typecheck → test → build. There is no linter configured.
`scripts/e2e.mjs` is a live-stack smoke test — see its header for usage.

## Layout

- `packages/shared` — zod schemas + types; single source of truth for api and web
- `packages/api` — Fastify, ESM (imports use explicit `.js` extensions); schema in `db/schema.sql`
- `packages/web` — React 18 + Vite PWA; no tests yet

## Notes

- The API fails fast on missing/invalid env vars (`src/env-schema.ts`); `.env.example` lists them.
- Never log or persist student PII outside the per-trip encrypted scope (ADR 0001).
- More detail: `docs/development.md`, `docs/deployment.md`, `docs/data-model.md`.
