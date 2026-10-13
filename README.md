# PixExplore

> Anciennement **Trip Challenges** : le dépôt (`FB-UNIV/trip-challenges`), les images Docker
> (`ghcr.io/fb-univ/trip-api`, `trip-web`) et les paquets `@trip/*` gardent ce nom, rien ne
> change pour les installations existantes.

> *A French-language PWA for photo-challenge school trips, with provable erasure of
> minors' data. Self-hosted, AGPL-3.0. Documentation is in French.*

Une PWA pour les sorties scolaires en mode défis photo. Les élèves relèvent les défis de
leur enseignant en envoyant des photos (via QR code), sélectionnent leur meilleure, puis
votent **façon Tinder** pour élire les gagnants. Les participants étant mineurs, **toutes
les données des élèves sont effacées de façon vérifiable** à la fin de la sortie
(effacement cryptographique : on détruit la clé de la sortie, et toute copie, sauvegardes
comprises, devient illisible).

📖 **Documentation en ligne : https://fb-univ.github.io/trip-challenges/** — guides par rôle (enseignant,
élève et familles, chef d'établissement, DPO, administrateur) et modèle de menaces.

- Glossaire du domaine → [`CONTEXT.md`](./CONTEXT.md)
- Décisions d'architecture → [`docs/adr/`](./docs/adr)
- Schéma de la base → [`docs/data-model.md`](./docs/data-model.md)
- **Déployer en production** → [`docs/deployment.md`](./docs/deployment.md) · puis [`docs/production-hardening.md`](./docs/production-hardening.md)
- **Monter un environnement de développement** → [`docs/development.md`](./docs/development.md)
- **RGPD : rôles, fiche de traitement, note aux familles** → [`docs/rgpd.md`](./docs/rgpd.md)

## Fonctionnement

```
brouillon ──▶ défis ──▶ vote ──▶ révélation ──▶ délai de grâce ──▶ effacée
 équipes      envoi +     duels     cérémonie     résultats          effacement
 formées      sélection   par paire               souvenir           crypto (clé détruite)
```

L'enseignant se connecte (OIDC), crée une sortie, importe la liste des élèves (qui
reçoivent leur code d'accès par e-mail) et ajoute des défis (chacun avec son QR code à
imprimer). Les élèves forment des équipes, envoient et sélectionnent des photos, puis
votent. L'enseignant modère, fait avancer les phases et dévoile les résultats.
L'effacement se déclenche automatiquement après un délai de grâce (ou à une date butoir),
ou à la demande.

## Composants

| Composant | Rôle | Remarques |
|---|---|---|
| **PWA** (React + Vite) | interface élève + enseignant | installable, appareil photo/QR |
| **API** (Fastify + TS) | toute la logique métier | port 3000 |
| **Postgres** | données relationnelles, cloisonnées par `trip_id` | |
| **Stockage objet** | photos chiffrées (API S3) | MinIO fourni ; ou AWS S3 / R2 / B2 |
| **Vault** | clés de chiffrement par sortie (transit) | le mécanisme d'effacement |
| **ClamAV** | analyse chaque envoi (refus en cas de panne) | fourni ; `AV_SCAN_ENABLED` |
| **PocketID** | authentification des enseignants (OIDC) | *à fournir* |
| **Relais SMTP** | envoi des codes d'accès et des alertes | *à fournir* |
| **Traefik** | terminaison TLS + en-têtes de sécurité | *à fournir (existant)* |

---

## Installation — pour les exploitants (hébergement autonome)

> 📘 Ceci est le démarrage rapide. Le **guide complet** — S3 externe, déploiement sur une
> seule machine par IP, TLS, mises à jour, vérifications — est dans
> [`docs/deployment.md`](./docs/deployment.md).

### Prérequis

Avant de commencer, il vous faut :

1. **Un serveur Linux** avec **Docker** (Engine 24+) et **Docker Compose v2**.
2. **Un nom d'hôte public** (par ex. `defis.mon-college.fr`) dont l'enregistrement DNS
   pointe vers votre **Traefik**.
3. **Traefik** sur votre VPS frontal (fournisseur « file » — voir l'étape 4).
4. Un **lien privé** (WireGuard/VPN) entre le Traefik frontal et ce serveur applicatif.
5. Une instance **PocketID** (ou tout fournisseur OIDC) pour la connexion des enseignants.
6. Un serveur ou relais **SMTP** pour envoyer les e-mails.

### Étapes

```bash
git clone https://github.com/FB-UNIV/trip-challenges.git && cd trip-challenges
cp .env.example .env
```

**1. Remplissez `.env`**, en particulier :

- `APP_HOST` — votre nom d'hôte public · `PUBLIC_BASE_URL=https://<APP_HOST>`
- `APP_BIND_ADDR` — l'**IP WireGuard/VPN** de ce serveur (jamais `0.0.0.0`)
- `POSTGRES_PASSWORD`, `S3_*` (identifiants/bucket du stockage), `SESSION_SECRET` (64 octets aléatoires)
- `VAULT_*` — en production, **pas** de mode dev (voir l'avertissement ci-dessous)
- `OIDC_*` — depuis votre client PocketID (redirection `https://<APP_HOST>/api/auth/teacher/callback`)
- `SMTP_*` — votre relais de messagerie

**2. Déclarez le client OIDC** dans PocketID avec l'URI de redirection ci-dessus.

**3. Démarrez le serveur applicatif**, avec les images publiées (signées — voir
[§ 7 du guide](./docs/deployment.md#7-cicd-github-actions)) ou en les construisant :

```bash
# images publiées : IMAGE_API=ghcr.io/fb-univ/trip-api:<version> et IMAGE_WEB=… dans .env
docker compose pull
# ou construction locale
docker compose build

docker compose up -d
```

Cela lance `web` + `api` (liés à `APP_BIND_ADDR`) ainsi que `postgres`, `vault` et
`clamav` sur un réseau privé ; `minio` aussi si vous avez décommenté son bloc (sinon,
stockage S3 externe). Le schéma de la base est appliqué automatiquement au
premier démarrage.

**4. Configurez le Traefik frontal.** Copiez [`traefik/dynamic.yml`](./traefik/dynamic.yml)
sur votre VPS Traefik (fournisseur « file ») en remplaçant `APP_BACKEND_HOST` par l'IP VPN
de ce serveur. Traefik termine le TLS et ajoute les en-têtes HSTS/CSP/sécurité.

**5. Vérifiez :**

```bash
curl -s https://<APP_HOST>/api/healthz     # {"status":"ok"}
```

Ouvrez `https://<APP_HOST>/teacher` et connectez-vous avec PocketID.

> ⚠️ **Avant toute donnée réelle, durcissez le déploiement** →
> [`docs/production-hardening.md`](./docs/production-hardening.md). Le Vault fourni tourne
> en **mode dev** (en mémoire, descellé automatiquement, jeton root) : bien pour évaluer,
> **pas** pour les données de vrais mineurs. Le guide couvre le stockage persistant et un
> vrai scellement, un jeton d'API restreint (pas root), et la règle de sauvegarde qui rend
> l'effacement cryptographique réel : le stockage de Vault doit rester **hors des
> sauvegardes de la base** (voir
> [ADR-0001](./docs/adr/0001-crypto-erasure-with-vault-per-trip-keys.md)).

---

## Installation — pour les développeurs (environnement local)

> 📘 Ceci est le démarrage rapide. Le **guide complet** — tests sur téléphone/QR,
> connexion enseignant en dev, parcours élève, dépannage — est dans
> [`docs/development.md`](./docs/development.md).

### Prérequis

- **Node.js ≥ 20** et **npm ≥ 10**
- **Docker + Compose v2** (uniquement pour les services de données)

### Étapes

```bash
git clone https://github.com/FB-UNIV/trip-challenges.git && cd trip-challenges
npm install
```

**1. Démarrez les services de données** (Postgres, MinIO, Vault — exposés sur `localhost`) :

```bash
docker compose -f docker-compose.dev.yml up -d
```

**2. Créez `.env`** pour le dev — copiez `.env.example` et pointez les hôtes vers localhost :

```
POSTGRES_HOST=localhost
S3_ENDPOINT=http://localhost:9000
VAULT_ADDR=http://localhost:8200
PUBLIC_BASE_URL=http://localhost:5173
SESSION_SECRET=dev-secret-please-change-32chars-min
# OIDC_* — seulement pour tester la connexion enseignant (vers un PocketID de dev)
```

**3. Lancez l'API et la PWA** (deux terminaux) :

```bash
npm run dev:api      # Fastify sur :3000
npm run dev:web      # Vite sur :5173 (proxy /api → :3000)
```

Ouvrez http://localhost:5173. Le **parcours élève fonctionne sans OIDC** ; la
**connexion enseignant** nécessite un PocketID joignable (`OIDC_*`). Pour tester le
parcours élève, importez une liste d'élèves en tant qu'enseignant (ou alimentez la base)
pour générer des codes d'accès — en dev, les e-mails sont affichés dans la console de
l'API au lieu d'être envoyés.

### Vérifications

```bash
npm test           # tests unitaires (Vitest) — aucune infrastructure requise
npm run typecheck  # tsc sur tous les workspaces
npm run build      # api → dist, web → bundle statique + service worker
```

### Organisation

```
packages/
  shared/   schémas zod + types (source unique pour api et web)
  api/      service Fastify · db/migrations · clients Vault/S3 · effacement · test/
  web/      PWA React (élève + enseignant)
e2e/        tests Playwright sur la pile complète
docs/       adr/ · data-model.md · guides
traefik/    dynamic.yml (configuration du fournisseur « file » du frontal)
```

---

## Tests

`npm test` lance la suite Vitest sans aucune infrastructure. Les suites API et web
imposent des seuils de couverture (`packages/{api,web}/vitest.config.ts`).

- **shared** — valeurs par défaut et validation des schémas (`TripConfig`, `ChallengeInput`…)
- **routes et domaine de l'API** — chaque plugin de route, le cycle de vie et le calcul
  des résultats, l'effacement, le planificateur et l'envoi des codes, exécutés sur les
  vraies `db/migrations` dans [PGlite](https://pglite.dev) (Postgres dans le processus)
  avec des doublures en mémoire pour Vault, S3 et SMTP (`packages/api/test/support/`). La
  doublure de Vault refuse de déchiffrer dès que la clé d'une sortie est détruite : les
  tests d'effacement vérifient donc l'effacement cryptographique, pas seulement la
  suppression des lignes.
- **enveloppes d'E/S de l'API** — Vault transit (`fetch` simulé), S3 (SDK simulé), SMTP
  (nodemailer simulé), découverte OIDC, normalisation d'image (vrai sharp), clamd sur un
  socket local.
- **fonctions pures de l'API** — classement de Wilson, jetons de duel, format AES-GCM de
  l'enveloppe, lecture de l'environnement, paliers d'alerte avant effacement, protocole
  INSTREAM de clamd.
- **web** — chaque écran monté sur ses vraies routes, avec l'API simulée par MSW.

Les bugs connus sont épinglés par des tests `it.fails(...)` avec un commentaire
`// BUG:` ; ils signalent « unexpectedly passed » une fois corrigés.

### Bout en bout (pile complète)

Les tests Playwright de [`e2e/`](./e2e) tournent en CI contre la pile complète (Postgres,
MinIO, Vault, Mailpit) ; en local : `npm run e2e:services` puis `npm run test:e2e`.

[`scripts/e2e.mjs`](./scripts/e2e.mjs) est un test de fumée HTTP contre une pile en
cours d'exécution ; il récupère les codes d'accès dans la sortie du mailer de dev, donc
il nécessite `NODE_ENV=development` (voir son en-tête).

## CI/CD (GitHub Actions)

Toute modification arrive sur `main` par une PR, fusionnée en squash avec le titre de la
PR comme message de commit. Les titres de PR doivent être des
[Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`…) :
ce sont eux qui déterminent la version.

Les workflows sont dans [`.github/workflows/`](./.github/workflows) :

- **`ci.yml`** — chaque PR et chaque push sur `main` : analyse de sécurité des workflows
  ([zizmor](https://docs.zizmor.sh)) → `npm ci` → typecheck → tests → build, plus une
  construction Docker (sans publication) des deux images.
- **`e2e.yml`** — les tests Playwright sur la pile complète.
- **`pr-title.yml`** — refuse les titres de PR qui ne sont pas des Conventional Commits.
- **`release.yml`** — [release-please](https://github.com/googleapis/release-please)
  maintient une PR de release avec la prochaine version [semver](https://semver.org) et
  le `CHANGELOG.md`. La fusionner crée le tag `vX.Y.Z` et la release GitHub, et publie
  les images publiques `ghcr.io/fb-univ/trip-api` et `trip-web` en `:X.Y.Z`, `:X.Y` et
  `:latest`, signées avec cosign et accompagnées d'un SBOM et d'une provenance
  ([vérifier](./docs/deployment.md#7-cicd-github-actions)).

Montées de version : `fix:` → patch, `feat:` → mineure, `feat!:` / `BREAKING CHANGE:` →
majeure (mineure tant que < 1.0). Les autres types ne publient pas de release.

Secret facultatif `RELEASE_PLEASE_TOKEN` (PAT à portée fine limité à ce dépôt, écriture
contents + pull-requests), rangé dans l'environnement protégé `release` (déploiements depuis
`main` uniquement) et non dans les secrets du dépôt : sans lui, les PR de release ne
déclenchent pas la CI et ne peuvent pas satisfaire les vérifications requises.

`main` est protégée par un ruleset sans contournement possible (administrateurs compris) :
PR obligatoire, fusion en squash, vérifications `check`, `docker (api)`, `docker (web)`,
`pr-title` et `e2e` réussies, aucune nouvelle alerte CodeQL élevée. Les tags `v*` ne peuvent
être ni déplacés ni supprimés, et une release publiée est immuable.

## Effacement

Il se déclenche automatiquement après le vote et un délai de grâce, à une date butoir
(`fin de sortie + durée de conservation`), ou à la demande d'un enseignant. Il supprime
les photos, les lignes contenant des données personnelles et les journaux, puis
**détruit la clé Vault de la sortie** pour que toute copie résiduelle en sauvegarde
devienne définitivement illisible. Seuls subsistent les résultats et un journal d'audit,
tous deux sans données personnelles. Voir
[`packages/api/src/erasure.ts`](./packages/api/src/erasure.ts) et
[ADR-0001](./docs/adr/0001-crypto-erasure-with-vault-per-trip-keys.md).

## État du projet

Le parcours complet est en place : connexion enseignant OIDC, création de sortie avec sa
clé Vault, import de la liste d'élèves en arrière-plan avec envoi des codes d'accès,
sessions élèves liées à l'appareil et nouveau code en cas de perte, équipes (et jeu en
solo), envoi de photos par QR depuis l'appareil photo ou la galerie (photo réduite et
débarrassée de ses EXIF sur le téléphone, progression et nouvel essai), analyse antivirus
bloquante, suppression des EXIF et chiffrement par enveloppe côté serveur, sélection et
modération par l'enseignant avec notification des élèves, duels par paire avec classement
de Wilson (paires déjà votées exclues), calcul des résultats avec gestion des égalités et
départage du grand champion, cérémonie de révélation sur vidéoprojecteur (résultats
invisibles pour les élèves avant publication), modification de la configuration selon la
phase, invitation de co-enseignants, vérification des noms d'équipe, effacement
automatique et à la demande avec effacement cryptographique et alertes e-mail
progressives avant l'effacement.

Reste à la charge de l'exploitant : le durcissement de Vault en production
([guide](./docs/production-hardening.md)) et la durée de conservation des journaux du
relais SMTP.

## Contribuer et licence

Les contributions sont les bienvenues — voir [`CONTRIBUTING.md`](./CONTRIBUTING.md).
Signalez les problèmes de sécurité en privé selon [`SECURITY.md`](./SECURITY.md).

Sous licence [GNU Affero General Public License v3.0](./LICENSE) ou ultérieure. Si vous
proposez une version modifiée comme service en réseau, vous devez en offrir le code
source à ses utilisateurs.
