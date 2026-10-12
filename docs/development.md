# Guide de développement

Monter un environnement local pour faire tourner et modifier Trip Challenges. Le
**parcours élève fonctionne sans aucun service externe** ; la **connexion enseignant**
nécessite soit un fournisseur OIDC, soit le raccourci de connexion de dev intégré
(ci-dessous).

- Architecture et glossaire → [`../CONTEXT.md`](../CONTEXT.md), [`adr/`](./adr)
- Production → [`deployment.md`](./deployment.md)

---

## 1. Prérequis

- **Node.js ≥ 20** et **npm ≥ 10** (l'API est en ESM ; les imports utilisent des extensions `.js` explicites).
- **Docker + Compose v2** — uniquement pour les services de données (Postgres, MinIO,
  Vault). L'API et la PWA tournent sur votre machine avec rechargement à chaud.

## 2. Installation

```bash
git clone https://github.com/FB-UNIV/trip-challenges.git && cd trip-challenges
npm install          # installe tous les workspaces (@trip/shared, @trip/api, @trip/web)
```

## 3. Démarrer les services de données

`docker-compose.dev.yml` ne lance que les services de soutien, exposés sur `localhost` :

```bash
docker compose -f docker-compose.dev.yml up -d
```

| Service | Port hôte | Remarques |
|---|---|---|
| Postgres | `5432` | vide ; l'API applique les migrations au démarrage |
| MinIO | `9000` (API), `9001` (console web) | identifiants par défaut `trip-minio` / `devpass123` |
| Vault | `8200` | mode dev, jeton root `dev-root-token` |

Chaque port est modifiable s'il entre en conflit avec quelque chose qui tourne déjà —
par ex. `MINIO_HOST_PORT=9002 MINIO_CONSOLE_PORT=9003 PG_HOST_PORT=5433 VAULT_HOST_PORT=8201 docker compose -f docker-compose.dev.yml up -d`.
Reportez les mêmes valeurs dans les adresses de votre `.env` ci-dessous.

## 4. Configurer `.env`

Copiez l'exemple et pointez tout vers `localhost` :

```bash
cp .env.example .env
```

Le minimum pour le parcours élève (sans OIDC, sans e-mail, sans antivirus) :

```ini
NODE_ENV=development
API_PORT=3000
PUBLIC_BASE_URL=http://localhost:5173

POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=trip
POSTGRES_USER=trip
POSTGRES_PASSWORD=devpass

# Stockage objet → le MinIO de dev fourni (API S3, path-style)
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=trip-minio
S3_SECRET_ACCESS_KEY=devpass123
S3_BUCKET=submissions
S3_FORCE_PATH_STYLE=true

VAULT_ADDR=http://localhost:8200
VAULT_TOKEN=dev-root-token
VAULT_TRANSIT_MOUNT=transit

SESSION_SECRET=dev-secret-please-change-32chars-min   # ≥ 32 caractères

AV_SCAN_ENABLED=false        # le compose de dev n'a pas de clamav ; laissez désactivé

# OIDC_* — seulement pour tester la vraie connexion enseignant ; inutile avec dev-login (§ 6)
```

L'API **s'arrête immédiatement** s'il manque une variable obligatoire — c'est voulu. Si
elle s'arrête au démarrage, l'erreur nomme la variable manquante ou invalide.

## 5. Lancer l'API et la PWA

Deux terminaux :

```bash
npm run dev:api      # Fastify sur :3000 (tsx watch — redémarre à chaque sauvegarde)
npm run dev:web      # Vite sur :5173, proxy /api → :3000
```

Ouvrez **http://localhost:5173**. Au premier démarrage, l'API active le moteur transit de
Vault et crée le bucket MinIO automatiquement.

### Tester depuis un téléphone (appareil photo / QR)

`npm run dev:web` lance `vite --host` : le serveur de dev est joignable sur votre réseau
local à `http://<ip-de-votre-machine>:5173`. Ouvrez cette adresse sur un téléphone du même
réseau pour tester l'appareil photo et le scan des QR codes. Le proxy `/api` tourne sur la
machine de dev, l'API n'a donc pas besoin d'être exposée séparément. (Une IP brute
fonctionne directement ; un nom d'hôte nécessite en plus `server.allowedHosts` dans
`vite.config.ts`.)

## 6. Se connecter en tant qu'enseignant (sans OIDC)

Quand `NODE_ENV` ne vaut pas `production`, l'API expose un raccourci sans mot de passe —
une porte dérobée réservée au dev, **non enregistrée en production** :

```bash
curl -c cookies.txt -X POST http://localhost:3000/api/auth/teacher/dev-login \
  -H 'content-type: application/json' -d '{"email":"enseignant@example.org"}'
```

Cela crée un cookie de session enseignant. Dans le navigateur, l'interface enseignant de
`/teacher` fonctionne alors. Pour tester le **vrai** parcours OIDC, pointez `OIDC_*` vers
un PocketID de dev et définissez
`OIDC_REDIRECT_URI=http://localhost:5173/api/auth/teacher/callback`.

## 7. Tester le parcours élève

1. En tant qu'enseignant, créez une sortie et importez une liste d'élèves (une adresse par
   ligne).
2. En dev (sans SMTP), les e-mails sont **affichés dans la console de l'API** — cherchez
   une ligne `[mail:dev] to=… :: Ton code d'accès pour …` contenant le lien
   `…/join?code=…`.
3. Ouvrez ce lien (`http://localhost:5173/join?code=<le-code>`) : il consomme le code et
   ouvre une session sur l'appareil. Ensuite : former une équipe, envoyer une photo via le
   QR d'un défi, voter.

## 8. Vérifications

```bash
npm test           # Vitest (api, shared, web) + seuils de couverture — aucune infrastructure requise
npm run typecheck  # tsc sur tous les workspaces
npm run build      # api → dist, web → bundle statique + service worker
```

Pour travailler de bout en bout avec de vrais services, gardez le compose de dev lancé et
pilotez l'API avec `curl` (voir `scripts/e2e.mjs`), ou lancez les tests Playwright de
`e2e/` (`npm run e2e:services` puis `npm run test:e2e`). Les tests unitaires n'ont besoin
d'aucune infrastructure : les tests de l'API exécutent le vrai schéma dans PGlite
(Postgres dans le processus) avec des doublures en mémoire pour Vault/S3/SMTP ; les tests
web montent les vraies routes dans jsdom (React Testing Library) contre une API simulée
par MSW.

## 9. Organisation

```
packages/
  shared/   schémas zod + types — la source unique pour api et web
  api/      service Fastify
    src/routes/     points d'accès HTTP (trips, roster, teams, submissions, duels, invites…)
    src/auth/       sessions + guard.ts : le preHandler de chaque route (rôle, sortie, phases)
    src/crypto/     Vault transit + chiffrement par enveloppe
    src/email/      mailer.ts — les e-mails (en français)
    src/storage/    s3.ts — stockage objet compatible S3 (MinIO/AWS/R2/B2)
    src/erasure.ts  la tâche d'effacement cryptographique + les alertes avant effacement
    src/scheduler.ts tâches de fond (effacement, alertes, envoi des codes) sous verrous consultatifs
    db/migrations/  SQL numéroté, appliqué par l'API au démarrage (src/migrate.ts)
    test/           tests unitaires Vitest
  web/      PWA React (Vite) — interface élève + enseignant, styles en ligne + index.css
    test/           Vitest + RTL + MSW (render.tsx monte src/routes.tsx)
e2e/        tests Playwright sur la pile complète
docs/       adr/ · data-model.md · deployment.md · development.md · production-hardening.md
traefik/    dynamic.yml (configuration du fournisseur « file » du frontal)
```

L'interface, les e-mails et les messages d'erreur de l'API sont en français (tutoiement) ;
le code, les identifiants, les codes d'erreur et les journaux restent en anglais.

## 10. Dépannage

| Symptôme | Cause / solution |
|---|---|
| L'API s'arrête dès le démarrage | Une variable d'environnement obligatoire manque ou est invalide — l'erreur la nomme. |
| `ECONNREFUSED` vers Postgres/MinIO/Vault | Services de données non lancés, ou un port a été déplacé. `docker compose -f docker-compose.dev.yml ps` ; alignez les adresses de `.env` sur les `*_HOST_PORT` modifiés. |
| Port déjà utilisé au `up` | Une autre pile locale occupe 5432/9000/8200. Relancez avec `PG_HOST_PORT=…`, `MINIO_HOST_PORT=…`, `VAULT_HOST_PORT=…`. |
| La redirection de connexion enseignant échoue | `OIDC_REDIRECT_URI` doit correspondre exactement à l'URI déclarée pour le client et finir par `/api/auth/teacher/callback`. Ou utilisez simplement dev-login (§ 6). |
| Pas d'e-mail de code d'accès | Normal en dev — les codes s'affichent dans la console de l'API. Définissez `SMTP_*` pour un vrai envoi. |
| Envois refusés avec `503 scan_unavailable` | `AV_SCAN_ENABLED=true` mais aucun clamd joignable. Mettez `false` en dev, ou lancez un conteneur clamav. |
| Erreurs Vault après `docker compose down -v` | Le Vault de dev est en mémoire ; supprimer les volumes détruit toutes les clés (toutes les sorties deviennent illisibles). Normal — recréez des sorties. |
