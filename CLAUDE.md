# PixExplore

PWA for photo-challenge school trips. Handles **minors' data under strict erasure** — read
`CONTEXT.md` (domain glossary) and `docs/adr/` before changing auth, storage, crypto or erasure.

## Commands

```bash
npm install                 # all workspaces
npm run typecheck           # tsc across workspaces
npm test                    # Vitest (api, shared, web), no infra needed; api + web enforce coverage thresholds
npm run build               # api → dist, web → static bundle + service worker
npm run dev:api             # builds @trip/shared, then Fastify on :3000 (tsx watch)
npm run dev:web             # builds @trip/shared, then Vite on :5173 (proxies /api → :3000)
docker compose -f docker-compose.dev.yml up -d   # Postgres, MinIO, Vault for local dev
```

CI (`.github/workflows/ci.yml`) runs a workflow lint (zizmor) → typecheck → test → build + Docker builds. There is no
code linter/formatter (ESLint, Prettier). `e2e.yml` runs the Playwright suite in `e2e/` against the full stack:
it drives the UI through the page objects in `e2e/pages/`, so a UI change (label, button, step) must update
them too — `e2e` is a required check. `scripts/e2e.mjs` is a separate live-stack HTTP smoke test (see its header).

## Git workflow

- Never commit or push to `main` — the `protect-main` ruleset (no bypass, not even admins) rejects
  direct pushes and requires `check`, `docker (api)`, `docker (web)`, `pr-title` and `e2e` to pass,
  plus no new high CodeQL alert. `v*` tags can't be moved or deleted, and releases are immutable. Branch (`feat/…`, `fix/…`, `ci/…`, `docs/…`),
  push, open a PR with `gh pr create`.
- PRs are squash-merged; the **PR title** is the commit and must be a Conventional Commit.
  It sets the semver bump: `fix:` patch, `feat:` minor, `feat!:` major. `docs/ci/chore/…` don't release.
- Releases are cut by merging release-please's `chore(main): release …` PR — never tag by hand
  or edit `CHANGELOG.md` / `.release-please-manifest.json` manually.

## Layout

- `packages/shared` — zod schemas + types; single source of truth for api and web
- `packages/api` — Fastify, ESM (imports use explicit `.js` extensions); schema in `db/migrations/` (numbered SQL, applied at boot by `src/migrate.ts`; never edit a shipped migration, add the next number)
- `packages/web` — React 18 + Vite PWA; tests mount the real routes (`test/render.tsx`) against MSW —
  declare every endpoint a screen hits with `server.use(...)`, unhandled requests fail the test

## Tests

- API route/domain tests run the real migrations in PGlite (in-process WASM Postgres) and
  swap Vault, S3 and SMTP for in-memory fakes — see `packages/api/test/support/`. New test files
  copy the `vi.mock(...)` block from an existing one, then use `harness.ts` fixtures.
- Web test setup (`packages/web/test/setup.ts`) bridges jsdom's `FormData`/`File` to MSW for both `fetch`
  and `XMLHttpRequest` (photo uploads use XHR for progress), provides object URLs, and restores jsdom's
  `localStorage` (Node 25's own global shadows it) — cleared after each test.
- A known, unfixed bug is recorded as `it.fails(...)` with a `// BUG:` comment. When you fix it,
  the test starts "unexpectedly passing" — flip it to `it(...)`.
- Coverage thresholds live in `packages/{api,web}/vitest.config.ts`; raise them, don't lower them.

## Notes

- The API fails fast on missing/invalid env vars (`src/env-schema.ts`); `.env.example` lists them.
- Never log or persist student PII outside the per-trip encrypted scope (ADR 0001).
- Every route declares `{ preHandler: guard({ role, trip, phases }) }` (`src/auth/guard.ts`);
  `test/guard.test.ts` fails on a route without one. Read the result with `tripOf/teacherOf/studentOf`.
- More detail: `docs/development.md`, `docs/deployment.md`, `docs/data-model.md`.
