# Contribuer

Merci de votre aide ! Cette application traite **des données de mineurs soumises à un
effacement strict** : certaines règles sont donc plus exigeantes que d'habitude. Les
problèmes de sécurité passent par [`SECURITY.md`](./SECURITY.md), jamais par un ticket
public. En participant, vous acceptez le [code de conduite](./CODE_OF_CONDUCT.md).

Le projet est en français (interface, e-mails, documentation). Le code, les identifiants,
les codes d'erreur et les journaux restent en anglais ; les tickets et PR peuvent être
rédigés en français ou en anglais.

## Avant de commencer

- Pour tout ce qui dépasse une petite correction, ouvrez d'abord un ticket pour qu'on
  s'accorde sur l'approche.
- Lisez [`CONTEXT.md`](./CONTEXT.md) (glossaire du domaine) et les [ADR](./docs/adr/)
  avant de toucher à l'authentification, au stockage, à la cryptographie ou à
  l'effacement.
- Environnement de dev : [`docs/development.md`](./docs/development.md). Les tests
  unitaires et de routes ne demandent aucune infrastructure (Postgres tourne dans le
  processus via PGlite ; Vault, S3 et SMTP sont simulés).

```bash
npm install
npm run typecheck && npm test && npm run build   # ce que lance la CI
npm run docs:dev                                 # le site de documentation (docs/, VitePress)
```

La documentation vit dans `docs/` et est publiée sur https://fb-univ.github.io/trip-challenges/.
Un changement de comportement met à jour la page de rôle concernée (et le
[modèle de menaces](./docs/securite/menaces.md) s'il touche à la sécurité).

## Pull requests

- Partez de `main` (`feat/…`, `fix/…`, `docs/…`, `ci/…`).
- Les PR sont fusionnées en squash : le **titre de la PR** devient le commit et l'entrée
  du changelog. Il doit suivre les [Conventional Commits](https://www.conventionalcommits.org/) :
  `fix:` (patch), `feat:` (mineure), `feat!:` (rupture), ou `docs:` / `ci:` / `chore:` /
  `test:` / `refactor:` (pas de release). La CI le vérifie.
- Ne modifiez pas `CHANGELOG.md` ni `.release-please-manifest.json` : release-please s'en
  charge.

## Règles de code

- **Ne jamais journaliser ni conserver de données personnelles d'élèves** hors du
  périmètre chiffré de la sortie
  ([ADR 0001](./docs/adr/0001-crypto-erasure-with-vault-per-trip-keys.md)).
- Chaque route de l'API déclare `{ preHandler: guard({ role, trip, phases }) }` ; un test
  échoue si une route n'en a pas.
- Les migrations de `packages/api/db/migrations/` ne font que s'ajouter : ne modifiez
  jamais une migration livrée, ajoutez le numéro suivant.
- Les types et schémas partagés vivent dans `packages/shared` (zod) — ne les dupliquez pas.
- L'API est en ESM : les imports relatifs utilisent des extensions `.js` explicites.
- Les textes affichés sont en français, avec le tutoiement, et reprennent le vocabulaire
  de l'interface (sortie, défi, équipe, élève, enseignant, effacement…).

## Tests

- Ajoutez ou mettez à jour les tests à chaque changement de comportement. Les tests de
  l'API copient le bloc `vi.mock(...)` d'un test existant et utilisent les fixtures de
  `packages/api/test/support/harness.ts`. Les tests web montent les vraies routes contre
  MSW — déclarez chaque point d'accès appelé par un écran.
- Un bug connu non corrigé est consigné par un `it.fails(...)` avec un commentaire
  `// BUG:` ; quand vous le corrigez, passez-le en `it(...)`.
- Les seuils de couverture (`packages/{api,web}/vitest.config.ts`) peuvent monter, jamais
  descendre.

## Licence

En contribuant, vous acceptez que vos contributions soient publiées sous la
[GNU AGPL-3.0](./LICENSE), la licence du projet.
