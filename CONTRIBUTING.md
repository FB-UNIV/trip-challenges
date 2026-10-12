# Contributing

Thanks for helping! This app handles **minors' data under strict erasure**, so a few rules
are stricter than usual. Security issues go through [`SECURITY.md`](./SECURITY.md), never
a public issue.

## Before you start

- For anything beyond a small fix, open an issue first so we can agree on the approach.
- Read [`CONTEXT.md`](./CONTEXT.md) (domain glossary) and the [ADRs](./docs/adr/) before
  touching auth, storage, crypto or erasure.
- Dev setup: [`docs/development.md`](./docs/development.md). Unit/route tests need no
  infrastructure (Postgres runs in-process via PGlite; Vault, S3 and SMTP are faked).

```bash
npm install
npm run typecheck && npm test && npm run build   # what CI runs
```

## Pull requests

- Branch from `main` (`feat/…`, `fix/…`, `docs/…`, `ci/…`).
- PRs are squash-merged, so the **PR title** becomes the commit and the changelog entry.
  It must be a [Conventional Commit](https://www.conventionalcommits.org/): `fix:` (patch),
  `feat:` (minor), `feat!:` (breaking), or `docs:` / `ci:` / `chore:` / `test:` /
  `refactor:` (no release). CI checks it.
- Don't edit `CHANGELOG.md` or `.release-please-manifest.json` — release-please owns them.

## Code rules

- **Never log or persist student PII** outside the per-Trip encrypted scope
  ([ADR 0001](./docs/adr/0001-crypto-erasure-with-vault-per-trip-keys.md)).
- Every API route declares `{ preHandler: guard({ role, trip, phases }) }`; a test fails
  on a route without one.
- Migrations in `packages/api/db/migrations/` are append-only: never edit a shipped one,
  add the next number.
- Shared types and schemas live in `packages/shared` (zod) — don't duplicate them.
- The API is ESM: relative imports use explicit `.js` extensions.

## Tests

- Add or update tests with every behaviour change. API tests copy the `vi.mock(...)` block
  from an existing test and use the fixtures in `packages/api/test/support/harness.ts`.
  Web tests mount real routes against MSW — declare every endpoint a screen hits.
- A known, unfixed bug is recorded as `it.fails(...)` with a `// BUG:` comment; when you
  fix it, flip it to `it(...)`.
- Coverage thresholds (`packages/{api,web}/vitest.config.ts`) may go up, never down.

## License

By contributing, you agree that your contributions are licensed under the
[GNU AGPL-3.0](./LICENSE), the project's license.
