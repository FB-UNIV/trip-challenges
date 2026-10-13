# Guide de déploiement (production)

Comment mettre en service PixExplore pour un usage réel. Ce guide sert à « faire
tourner » ; une fois que c'est le cas, suivez
[`production-hardening.md`](./production-hardening.md) avant d'y mettre les données de
vrais mineurs : il couvre Vault, les sauvegardes et la garantie d'effacement.

- **Architecture** → [ADR-0003](./adr/0003-self-hosted-docker-compose-over-managed-ha.md)
- **Référence des variables** → [§ 8](#8-référence-des-variables-denvironnement), et [`.env.example`](https://github.com/FB-UNIV/trip-challenges/blob/main/.env.example) (chaque variable, commentée)
- **Environnement de dev** → [`development.md`](./development.md)

---

## 1. Ce qui tourne

`docker-compose.yml` démarre cinq services sur un réseau bridge privé, plus MinIO, fourni
mais **commenté** (à activer si vous n'avez pas de stockage S3 externe, voir § 4) :

| Service | Image | Exposé ? | Rôle |
|---|---|---|---|
| `web` | `trip-web` (nginx) | `${APP_BIND_ADDR}:8080 → 80` | bundle statique de la PWA |
| `api` | `trip-api` (Fastify) | `${APP_BIND_ADDR}:3000 → 3000` | toute la logique métier ; écoute `0.0.0.0:3000` dans le conteneur |
| `postgres` | `postgres:16-alpine` | interne uniquement | données relationnelles (données personnelles chiffrées) |
| `minio` | `minio/minio` | interne uniquement | stockage objet — **commenté par défaut** (voir § 4) |
| `vault` | `hashicorp/vault` | interne uniquement | clés cryptographiques par sortie (le mécanisme d'effacement) |
| `clamav` | `clamav/clamav` | interne uniquement | analyse des envois avant stockage |

`web` et `api` se lient à `APP_BIND_ADDR` (par défaut `127.0.0.1`) — **pas** à
l'internet public. Un composant placé devant termine le TLS et leur transmet le trafic.
Deux configurations sont prises en charge :

- **A — Frontal séparé** (l'architecture prévue) : une machine Traefik/nginx/Caddy
  joint ce serveur par un lien privé (WireGuard). Voir § 3A.
- **B — Une seule machine sur une IP** : un proxy inverse sur la *même* machine publie un
  port HTTPS sur l'IP du serveur. Voir § 3B. **C'est la voie à suivre si vous voulez
  simplement « publier sur une IP ».**

Il faut **une seule origine** servant à la fois la SPA (`/`) et l'API (`/api`) :
l'application utilise des cookies de même origine en `SameSite=strict`, donc séparer les
deux sur des origines différentes casse les sessions.

---

## 2. Prérequis

1. Un serveur Linux avec **Docker Engine 24+** et **Compose v2**.
2. **Un stockage objet** — le MinIO fourni, ou un bucket S3 externe (AWS S3, Cloudflare
   R2, Backblaze B2). Voir § 4.
3. **Vault** — le Vault fourni en mode dev démarre instantanément pour évaluer ; pour de
   vraies données, il faut d'abord le passer en mode production
   ([durcissement § 1](./production-hardening.md#1-vault-hors-du-mode-dev)).
4. Une instance **PocketID** (ou tout fournisseur OIDC) pour la connexion des
   enseignants. Les élèves n'ont **pas** besoin d'OIDC : ils s'authentifient avec le code
   d'accès reçu par e-mail.
5. Un relais **SMTP** pour envoyer les codes d'accès et les alertes d'effacement. (Sans
   lui, l'application tourne mais ne peut pas distribuer les codes : bien pour un test de
   fumée, pas pour un usage réel.)
6. **TLS.** La connexion enseignant utilise un cookie de transaction OIDC toujours
   `Secure` : l'espace enseignant **exige HTTPS**. Prévoyez un certificat (réel, ou l'AC
   interne de Caddy).

---

## 3. Configurer et démarrer

```bash
git clone https://github.com/FB-UNIV/trip-challenges.git && cd trip-challenges
cp .env.example .env
```

Modifiez `.env` — les variables les plus importantes :

| Variable | Valeur |
|---|---|
| `NODE_ENV` | imposé à `production` pour l'api par `docker-compose.yml`, quelle que soit la valeur de `.env` (cookies `Secure`, porte dérobée de connexion de dev **désactivée**) |
| `APP_HOST` | le nom d'hôte public ; les règles Traefik de `docker-compose.yml` routent dessus |
| `PUBLIC_BASE_URL` | l'URL publique utilisée, par ex. `https://defis.mon-college.fr` ou `https://203.0.113.10` — les QR codes l'intègrent |
| `APP_BIND_ADDR` | adresse à laquelle `web`/`api` se lient. Avec frontal : l'IP WireGuard de ce serveur. Machine unique : `127.0.0.1` (le proxy les joint localement) |
| `SESSION_SECRET` | 64 octets aléatoires (`openssl rand -hex 32`) |
| `POSTGRES_PASSWORD` | aléatoire et robuste |
| `S3_*` | stockage — voir § 4 |
| `VAULT_ADDR` / `VAULT_TOKEN` | jeton de dev pour évaluer ; AppRole en production (durcissement § 1b) |
| `OIDC_*` | depuis votre client PocketID ; l'URI de redirection doit être `PUBLIC_BASE_URL` + `/api/auth/teacher/callback` |
| `SMTP_*` | votre relais de messagerie |
| `AV_SCAN_ENABLED` | `true` (les envois sont refusés si clamd est arrêté) |

Déclarez le client OIDC dans PocketID avec l'URI de redirection
`<PUBLIC_BASE_URL>/api/auth/teacher/callback`. La connexion n'est acceptée que si le jeton
porte `email_verified: true` (c'est le cas de PocketID) : l'adresse sert à lier les invitations
de co-enseignants. Avec un autre fournisseur OIDC, vérifiez qu'il envoie cette information.

Démarrez avec les images publiées (voir § 7) ou en les construisant :

```bash
docker compose pull     # avec IMAGE_API / IMAGE_WEB dans .env
# ou : docker compose build
docker compose up -d
```

L'API applique elle-même le schéma Postgres au démarrage : des fichiers SQL numérotés dans
`packages/api/db/migrations/`, chacun dans une transaction, enregistrés dans
`schema_migrations`, sous un verrou consultatif pour que les réplicas ne se concurrencent
pas. Une base créée par l'ancien script d'initialisation `schema.sql` est reprise
automatiquement en `0001_baseline`. Pour modifier le schéma, ajoutez le fichier numéroté
suivant ; ne modifiez jamais un fichier déjà livré.

clamav télécharge ses bases de signatures au premier démarrage (~1–2 min) ; l'`api`
l'attend.

### 3A. Modèle avec frontal (VPS Traefik séparé)

Mettez dans `APP_BIND_ADDR` l'IP WireGuard de ce serveur. Copiez
[`traefik/dynamic.yml`](https://github.com/FB-UNIV/trip-challenges/blob/main/traefik/dynamic.yml) sur votre VPS Traefik (fournisseur
« file ») en remplaçant `APP_BACKEND_HOST` par cette IP. Traefik termine le TLS et ajoute
les en-têtes HSTS/CSP/sécurité. Pour la haute disponibilité, faites tourner un second
serveur applicatif et déclarez les deux backends : Traefik répartit la charge et vérifie
leur santé.

### 3B. Une seule machine sur une IP (proxy inverse sur la même machine)

Gardez `APP_BIND_ADDR=127.0.0.1`. Installez sur la machine un proxy inverse qui écoute sur
l'IP publique et route `/` → `web:8080` et `/api` → `api:3000` **sur une seule origine**.
Caddy est le plus simple et fournit le HTTPS sur une IP grâce à son AC interne :

```
# Caddyfile — remplacez 203.0.113.10 par l'IP de votre serveur (ou un nom d'hôte)
https://203.0.113.10 {
    tls internal                      # auto-signé ; ou un vrai certificat / votre domaine
    # Les mêmes en-têtes de sécurité que traefik/dynamic.yml — indispensables (CSP, HSTS…).
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "no-referrer"
        Permissions-Policy "camera=(self), geolocation=()"
        Content-Security-Policy "default-src 'self'; img-src 'self' blob: data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
        -Server
    }
    handle /api/* {
        reverse_proxy 127.0.0.1:3000
    }
    handle {
        reverse_proxy 127.0.0.1:8080
    }
}
```

```bash
# le plus rapide : Caddy dans un conteneur qui partage le réseau de l'hôte
docker run -d --name tc-edge --network host \
  -v "$PWD/Caddyfile:/etc/caddy/Caddyfile" \
  -v caddy_data:/data caddy:2
```

Puis définissez `PUBLIC_BASE_URL=https://203.0.113.10` et relancez `docker compose up -d`.

> ⚠️ **Pourquoi HTTPS même sur une IP.** Les cookies de session sont `Secure` quand
> `NODE_ENV=production`, et le cookie de connexion OIDC des enseignants est **toujours**
> `Secure`. En `http://<IP>` simple, le navigateur ignore ces cookies sans rien dire →
> **la connexion enseignant et les sessions élèves ne fonctionnent pas.** Options, de la
> meilleure à la moins bonne : (1) HTTPS via `tls internal` de Caddy (en acceptant
> l'alerte de certificat) ou un vrai certificat ; (2) un nom de domaine avec Let's
> Encrypt. Passer en `NODE_ENV=development` pour contourner le drapeau des cookies n'est
> **pas** envisageable en production : cela réactive `/dev-login`, une porte dérobée de
> connexion enseignant sans mot de passe.

---

## 4. Stockage objet — MinIO fourni ou S3 externe

L'API parle le protocole S3 ; le stockage est choisi entièrement par les variables
`S3_*`. Les photos sont chiffrées par enveloppe avant l'envoi : le stockage ne contient
jamais que du chiffré.

**MinIO fourni.** Dans `docker-compose.yml`, décommentez le bloc du service `minio`, la
ligne `minio:` du `depends_on:` de l'api et le volume `minio_data`, puis pointez l'API
dessus (ce sont les valeurs de `.env.example`) :

```
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=trip-minio
S3_SECRET_ACCESS_KEY=<identique à MINIO_ROOT_PASSWORD>
S3_BUCKET=submissions
S3_FORCE_PATH_STYLE=true
MINIO_ROOT_USER=trip-minio          # les identifiants propres au serveur minio
MINIO_ROOT_PASSWORD=<aléatoire et robuste>
```

**S3 externe (AWS / R2 / B2).** Laissez le bloc `minio` commenté, supprimez
`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` de `.env` et pointez `S3_*` vers le fournisseur :

```
# AWS S3 (créez le bucket à l'avance ; pas de S3_ENDPOINT)
S3_REGION=eu-west-3
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=...
S3_BUCKET=trip-challenges-prod
S3_FORCE_PATH_STYLE=false

# Cloudflare R2
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY_ID=<identifiant de clé r2>
S3_SECRET_ACCESS_KEY=<secret r2>
S3_BUCKET=trip-challenges
S3_FORCE_PATH_STYLE=false
```

Au démarrage, l'API s'assure que le bucket existe ; si ses identifiants ne peuvent pas
créer de bucket (cas fréquent sur AWS/R2), créez-le à l'avance et l'application
journalise un message clair au lieu d'échouer de façon obscure. Accordez à l'identifiant
de l'application `Get/Put/List/DeleteObject` sur le bucket — `DeleteObject` est
indispensable pour que l'effacement puisse balayer les fichiers d'une sortie.

**Auto-vérifications au démarrage.** Avant de servir, l'API prouve que ses identifiants
peuvent faire tout ce dont l'application a besoin, pour qu'une permission manquante fasse
échouer le démarrage plutôt que la requête d'un enseignant ou un effacement (#69) :

- **Stockage :** écrit, liste, relit puis supprime un objet de test sous `_selfcheck/`, en
  passant par le même chemin de suppression que l'effacement.
- **Vault :** crée une clé jetable `trip-selfcheck-…`, chiffre, déchiffre, calcule un HMAC,
  émet une clé de données, puis la détruit. La clé est supprimée même si une étape échoue.

Un échec arrête l'API en nommant ce qui manque, par exemple
`keystore self-check: could not compute an HMAC (vault 403). The Vault token needs "update" on
transit/hmac/trip-*`. Un 403 indique la permission ou la ligne de politique à ajouter. Le
reste (injoignable, scellé, ou un autre service qui répond sur le port S3) invite à
vérifier `S3_ENDPOINT` / `VAULT_ADDR`. Ces messages de démarrage restent en anglais.

---

## 5. Vérifier

```bash
curl -s http://127.0.0.1:3000/api/healthz          # {"status":"ok"} (en direct)
curl -sk https://<HÔTE_PUBLIC>/api/healthz          # via le frontal/proxy
curl -s http://127.0.0.1:3000/api/readyz           # {"status":"ready","checks":{"database":"ok","keystore":"ok","storage":"ok"}}
```

`/api/healthz` indique seulement que le processus tourne. `/api/readyz` répond 503
`not-ready` quand une dépendance est en panne et dit laquelle : `database` (ok/down),
`keystore` (ok/sealed/down) ou `storage` (ok/down). Faites pointer la vérification de
santé du proxy ou de l'orchestrateur vers `/readyz`, et alertez dessus.

- Ouvrez `https://<HÔTE_PUBLIC>/teacher` et connectez-vous avec PocketID.
- Vérifiez que la porte dérobée de dev est fermée en production :
  `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<hôte>/api/auth/teacher/dev-login`
  doit afficher `404` (la route n'est pas enregistrée quand `NODE_ENV=production`).
- Créez une sortie, importez une liste d'une ligne, vérifiez qu'un e-mail de code d'accès
  arrive.
- Envoyez une photo ; vérifiez qu'elle est analysée et stockée (voir
  `docker compose logs api`).

### Données de démonstration en préproduction

Pour parcourir tous les écrans sur une pile de **préproduction** sans vrais élèves,
créez trois sorties de démonstration appartenant à votre compte enseignant (connectez-vous
d'abord une fois via PocketID pour qu'il existe) :

```bash
docker compose exec -e SEED_DEMO=staging api \
  node packages/api/dist/scripts/seed-demo.js --teacher vous@etablissement.fr   # --small pour aller vite
```

Le script appelle les routes de l'API dans le processus : il exerce donc aussi les clés
Vault, le chiffrement, le traitement et l'analyse des photos, le vote et les résultats sur
la vraie pile. Vous obtenez :

| Sortie | État | À essayer |
|---|---|---|
| `[DEMO] draft — …` | 4 équipes, 3 défis (QR codes) | liens d'inscription → former/rejoindre des équipes, modifier les paramètres, avancer |
| `[DEMO] voting — …` | des photos validées pour chaque équipe | liens d'inscription → voter ; modération ; passer à la révélation |
| `[DEMO] reveal — …` | de vrais duels votés, résultats calculés | lien de la cérémonie, départage, passer au délai de grâce |

Les liens d'administration, de cérémonie et d'**inscription** (un par téléphone) sont
affichés (les élèves de démo ont des adresses `@example.invalid` impossibles à livrer ;
aucun e-mail n'est envoyé). Supprimez tout — par le chemin d'effacement normal, clés
détruites — avec :

```bash
docker compose exec -e SEED_DEMO=staging api node packages/api/dist/scripts/seed-demo.js --erase
```

Le script refuse de tourner sans `SEED_DEMO=staging`. Ne le lancez jamais en production.

---

## 6. Exploiter

- **Journaux :** `docker compose logs -f api`. Aucune donnée personnelle d'élève n'est
  jamais journalisée (invariant de conception) ; envoyez les journaux vers votre
  agrégateur, mais gardez-les **hors** du support de stockage de Vault.
- **Mises à jour :** récupérez/construisez les nouvelles images, puis
  `docker compose up -d`. L'API applique les migrations de schéma en attente au démarrage,
  avant de servir (cherchez `schema migrations applied` dans les journaux). Une migration
  en échec est annulée et l'API s'arrête : l'ancienne version garde la base intacte ;
  faites quand même une sauvegarde Postgres avant la mise à jour.
- **Sauvegardes et effacement :** sauvegardez Postgres et le stockage objet ensemble ;
  sauvegardez le stockage de Vault **à part et sous contrôle strict** — c'est cette
  séparation qui rend l'effacement cryptographique réel. Règles complètes au
  [durcissement § 2](./production-hardening.md#2-sauvegardes-et-garantie-deffacement).
- **Surveillance de l'effacement :** un effacement en échec est relancé chaque minute et
  envoie un e-mail aux enseignants de la sortie ainsi qu'à `ALERT_EMAIL` (au plus une
  fois par heure et par sortie). Définissez `HEARTBEAT_URL` vers un contrôle de type
  « dead man's switch » (par ex. healthchecks.io, ~5 min de tolérance) : il n'est appelé
  qu'après un cycle où tous les effacements dus ont réussi, si bien qu'un planificateur
  arrêté *comme* un effacement bloqué déclenchent une alerte.
- **Effacement d'urgence :** « Effacer maintenant » côté enseignant, ou destruction
  manuelle de la clé Vault d'une sortie — voir
  [durcissement § 6](./production-hardening.md#6-effacement-durgence-à-la-demande).

---

## 6b. Test de charge (#63)

La charge visée est d'environ 50 élèves actifs en même temps, le pire cas étant tout le
monde en train de voter. `loadtest/` la reproduit contre la vraie API, Postgres, MinIO,
Vault et Mailpit :
- **Données :** 50 élèves se connectent avec de vrais codes d'accès reçus par e-mail et
  forment 10 équipes, avec une photo d'environ 500 Ko par équipe et par défi, validée,
  puis la sortie passe au vote. Une seconde sortie reste en phase de défis pour les envois.
- **k6 :** 50 élèves virtuels enchaînent duel suivant → les deux photos → vote (1–3 s
  pour regarder), pendant que 5 autres envoient des photos.

```bash
npm run e2e:services                       # la pile compose des tests e2e
npm run build -w @trip/shared && npm run build -w @trip/api
eval "$(npx tsx loadtest/api-env.ts)" && (cd packages/api && node dist/server.js &)
npx tsx loadtest/seed.mts
k6 run loadtest/voting.k6.js               # ou : docker run --rm --network host -v "$PWD":/repo -w /repo grafana/k6 run loadtest/voting.k6.js
node loadtest/report.mjs                   # tableau Markdown à partir de loadtest/summary.json
```

Les seuils font échouer le test : < 1 % de requêtes en échec, p95 < 500 ms pour `me`,
`next` et `cast`, < 1,5 s pour les photos, < 3 s pour les envois. Un vote refusé (409, par
ex. paire déjà jugée) compte comme une réponse, pas comme un échec. Regardez aussi le
**p99 et le max** : une médiane rapide peut cacher un problème de verrous (voir #122).

**En préproduction**, k6 tourne depuis votre machine contre le vrai frontal, comme les
téléphones. Les données sont créées dans le conteneur de l'API sans aucun e-mail : des
élèves de démo avec de vraies sessions, toutes les sorties étant `[DEMO]`.

```bash
# Sur le serveur de préproduction (enseignant = un compte déjà connecté une fois via PocketID) :
docker compose exec -T -e SEED_DEMO=staging api \
  node packages/api/dist/scripts/seed-demo.js --teacher vous@etablissement.fr --loadtest > loadtest-state.json

# Sur votre machine, depuis le dépôt :
scp <serveur-preprod>:<dossier-compose>/loadtest-state.json loadtest/.state.json
npx tsx loadtest/photo.mts                       # la photo envoyée par le scénario d'envoi
k6 run loadtest/voting.k6.js                     # ou : docker run --rm -v "$PWD":/repo -w /repo grafana/k6 run loadtest/voting.k6.js
node loadtest/report.mjs

# Ensuite, sur le serveur de préproduction : effacer toutes les sorties [DEMO] (y compris celles de démonstration)
docker compose exec -e SEED_DEMO=staging api node packages/api/dist/scripts/seed-demo.js --erase
```

- **Tests plus lourds :** créez plus d'élèves qui envoient (`--uploaders 50` ; en local
  `UPLOADERS=50 npx tsx loadtest/seed.mts`) et passez les mêmes réglages à k6, par ex.
  `k6 run -e UPLOADERS=50 -e THINK=1 -e VOTERS=100 loadtest/voting.k6.js` (tous les
  réglages sont listés en tête de `voting.k6.js`). Depuis une seule machine, tout passe par
  une seule IP : au-delà d'environ 6000 requêtes/min (`RATE_LIMIT_MAX`), les 429 sont la
  limite par IP qui fait son travail, pas un problème de capacité. 50 élèves qui envoient,
  avec le temps de réflexion par défaut, restent en dessous.
- `.state.json` contient les **cookies de session** des élèves de démo : des secrets
  porteurs pour de faux comptes, qui disparaissent au `--erase`. Il est ignoré par git ;
  supprimez-le ensuite.
- Les limites de débit restent configurées telles quelles, volontairement. Tous les élèves
  virtuels partagent votre IP, comme une classe sur le Wi-Fi de l'établissement partage
  une seule adresse NAT. Un test plein de **429** signifie qu'une vraie classe qui vote
  ensemble serait elle aussi bridée. C'est arrivé en préproduction avec l'ancien
  `RATE_LIMIT_MAX=600` : 43 % des requêtes étaient des 429. La valeur par défaut est
  désormais 6000/min par IP, plus 600/min par élève connecté (`RATE_LIMIT_STUDENT_MAX`).
  Si votre `.env` fixe encore `RATE_LIMIT_MAX=600`, retirez-le.

En CI, `.github/workflows/loadtest.yml` tourne chaque semaine, sur les PR qui modifient
`loadtest/`, et à la demande. **Run workflow** accepte un `ref` : il construit et lance
l'API depuis ce tag ou cette branche avec le scénario du jour, pour comparer deux
versions. Les runners partagés donnent des chiffres **relatifs**. Comparez des
exécutions entre elles ; ne les lisez pas comme la capacité d'un VPS.

Mesuré sur un portable 12 cœurs, avec le même scénario pour chaque version :

| version | médiane (appels de vote) | p99 vote | max vote | débit | échecs |
|---|---|---|---|---|---|
| v0.7.0 : argon2 à chaque requête | ~1,5 s | 1,9 s | 12,9 s | 28 req/s | 0 % (tout est lent) |
| v0.8.0 : sessions SHA-256 (#64) | 6–19 ms | 2,6 s | 5,4 s | 83 req/s | 0,14 % (votes en interblocage) |
| main : + ordre de verrouillage corrigé (#122) | 6–19 ms | 62 ms | 134 ms | 85 req/s | 0 % |

## 7. CI/CD (GitHub Actions)

Workflows dans [`.github/workflows/`](https://github.com/FB-UNIV/trip-challenges/tree/main/.github/workflows) : `ci.yml` lance l'analyse des
workflows (zizmor) → typecheck → tests → build (et une construction Docker) sur chaque PR et
chaque push ; `release.yml`
utilise release-please pour publier des versions semver et pousse les images `trip-api` +
`trip-web` sur GHCR. Mettez ensuite les tags publiés dans `IMAGE_API`/`IMAGE_WEB` de
`.env` (par ex. `ghcr.io/fb-univ/trip-api:<version>`) puis `docker compose up -d` pour
déployer les images publiées au lieu de construire sur le serveur. Les images sont
publiques : pas besoin de `docker login`. Voir la section CI/CD du README.

Chaque image publiée est signée sans clé avec [cosign](https://docs.sigstore.dev/) par le
workflow de release, et embarque un SBOM et une provenance de construction. Vérifiez avant
de déployer :

```bash
cosign verify ghcr.io/fb-univ/trip-api:<version> \
  --certificate-identity-regexp '^https://github\.com/FB-UNIV/trip-challenges/\.github/workflows/release\.yml@refs/heads/main$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Une signature prouve que l'image a été construite par le workflow de release de ce dépôt
sur `main`. Les images antérieures à l'ajout de la signature (≤ 0.9.2) ne sont pas
signées. Les tags `v*` du dépôt sont protégés et les releases GitHub sont immuables (à partir
de 0.12.0) : une version publiée ne peut plus être modifiée.

## 8. Référence des variables d'environnement

### Lues par l'API

L'API vérifie ces variables au démarrage et s'arrête en nommant celle qui manque ou qui est
invalide.

<!-- AUTO-GENERATED from packages/api/src/env-schema.ts (names, required, defaults) — keep in sync -->
| Variable | Obligatoire | Défaut | Rôle |
|---|---|---|---|
| `API_PORT` | — | `3000` | Port d'écoute de l'API dans le conteneur. |
| `NODE_ENV` | — | `development` | `production` en production (imposé par `docker-compose.yml`) : cookies `Secure`, pas de `/dev-login`, refus d'afficher les e-mails sans SMTP. |
| `PUBLIC_BASE_URL` | **oui** |  | URL publique de l'instance ; intégrée aux QR codes et aux liens des e-mails. |
| `POSTGRES_HOST` | **oui** |  | Hôte Postgres (`postgres` avec compose). |
| `POSTGRES_PORT` | — | `5432` |  |
| `POSTGRES_DB` | **oui** |  |  |
| `POSTGRES_USER` | **oui** |  |  |
| `POSTGRES_PASSWORD` | **oui** |  | Aléatoire et robuste. |
| `S3_ENDPOINT` | non |  | Point d'accès S3 (MinIO, R2, B2) ; à omettre pour AWS. |
| `S3_REGION` | — | `us-east-1` |  |
| `S3_ACCESS_KEY_ID` | **oui** |  | Doit pouvoir `Get/Put/List/DeleteObject` sur le bucket. |
| `S3_SECRET_ACCESS_KEY` | **oui** |  |  |
| `S3_BUCKET` | — | `submissions` | Créé au démarrage si les droits le permettent. |
| `S3_FORCE_PATH_STYLE` | — | `true` | `true` pour MinIO ; `false` pour AWS et R2. |
| `VAULT_ADDR` | **oui** |  | Adresse de Vault (TLS en production). |
| `VAULT_TOKEN` | **oui** |  | Jeton restreint à la politique transit, jamais root en production. |
| `VAULT_TRANSIT_MOUNT` | — | `transit` | Point de montage du moteur transit. |
| `OIDC_ISSUER` | **oui** |  | URL du fournisseur d'identité (PocketID). Contacté à la première connexion seulement. |
| `OIDC_CLIENT_ID` | **oui** |  |  |
| `OIDC_CLIENT_SECRET` | **oui** |  |  |
| `OIDC_REDIRECT_URI` | **oui** |  | `PUBLIC_BASE_URL` + `/api/auth/teacher/callback`. |
| `SESSION_SECRET` | **oui** |  | 32 caractères minimum ; signe les cookies enseignants et les jetons de duel. Le changer déconnecte tous les enseignants, pas les élèves. |
| `TRUST_PROXY` | — | `loopback,linklocal,uniquelocal` | Proxys autorisés à fournir `X-Forwarded-For`. |
| `RATE_LIMIT_MAX` | — | `6000` | Requêtes par minute et par IP, toutes routes. |
| `RATE_LIMIT_STUDENT_MAX` | — | `600` | Requêtes par minute et par élève connecté. |
| `RATE_LIMIT_AUTH_MAX` | — | `5` | Essais par minute et par code d'accès. |
| `RATE_LIMIT_REDEEM_IP_MAX` | — | `100` | Essais de code d'accès par minute et par IP, quel que soit le code essayé. Prévoir une classe entière derrière une même IP. |
| `RATE_LIMIT_REISSUE_MAX` | — | `20` | Demandes de nouveau code par minute et par IP. |
| `AV_SCAN_ENABLED` | — | `false` | **`true` en production** (valeur de `.env.example`) : envois refusés si clamd est injoignable. |
| `CLAMAV_HOST` | — | `clamav` |  |
| `CLAMAV_PORT` | — | `3310` |  |
| `SMTP_HOST` | non |  | Sans lui : e-mails affichés dans la console en dev, refusés en production. |
| `SMTP_PORT` | — | `587` |  |
| `SMTP_USER` | non |  |  |
| `SMTP_PASSWORD` | non |  |  |
| `SMTP_FROM` | — | `PixExplore <no-reply@example.org>` | Expéditeur des e-mails. |
| `ALERT_EMAIL` | non |  | Reçoit aussi les alertes d'échec d'effacement. |
| `HEARTBEAT_URL` | non |  | Appelée après chaque cycle sain du planificateur (« dead man's switch »). |
| `SCW_TEM_PROJECT_ID` | non |  | Avec Scaleway TEM : l'ID du projet (comme `SMTP_USER`). Active la détection des rebonds : toutes les 5 min, les e-mails en échec passent l'élève en « Non distribué ». Va de pair avec la clé. |
| `SCW_TEM_SECRET_KEY` | non |  | La clé secrète de l'API Scaleway (comme `SMTP_PASSWORD`) ; il lui faut aussi la lecture de TEM. |
| `SCW_TEM_REGION` | — | `fr-par` | Région Scaleway de TEM. |
<!-- END AUTO-GENERATED -->

### Lues par `docker-compose.yml`

| Variable | Rôle |
|---|---|
| `APP_HOST` | Nom d'hôte public ; obligatoire (règles Traefik). |
| `APP_BIND_ADDR` | Adresse à laquelle `web` et `api` publient leurs ports (`127.0.0.1` par défaut) ; jamais `0.0.0.0`. |
| `IMAGE_API`, `IMAGE_WEB` | Images publiées à utiliser au lieu de construire (`trip-api:local`, `trip-web:local` par défaut). |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | Identifiants du MinIO fourni, s'il est activé ; identiques à `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`. |
