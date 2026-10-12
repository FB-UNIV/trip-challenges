# Guide de durcissement pour la production

Le `docker-compose.yml` fourni démarre pour **évaluer**. Avant qu'il n'accueille les
données de vrais mineurs, suivez cette liste. La pièce maîtresse est **Vault** : la
garantie d'effacement cryptographique (ADR-0001) ne vaut que ce que vaut la configuration
de production de Vault. Le reste relève de l'hygiène habituelle.

> La règle qui rend l'effacement réel : **le stockage de Vault ne doit jamais faire partie
> des mêmes sauvegardes que Postgres/MinIO.** Si le chiffré d'une photo et la clé qui le
> déchiffre peuvent être restaurés depuis la même sauvegarde, détruire la clé en
> production n'efface rien. Gardez-les sur des supports distincts, avec des durées de
> conservation distinctes. Voir le [§ 2](#2-sauvegardes-et-garantie-deffacement).

---

## 1. Vault hors du mode dev

Le conteneur de dev lance `vault server -dev` : stockage en mémoire, descellement
automatique, jeton root fixe. Perdre le conteneur, c'est perdre toutes les clés (toutes
les sorties instantanément « effacées ») ; le jeton root de `.env` peut tout faire.
Remplacez ces trois propriétés.

L'API n'a besoin que de `VAULT_ADDR`, `VAULT_TOKEN` et `VAULT_TRANSIT_MOUNT` (par défaut
`transit`). Elle effectue les opérations transit `encrypt`/`decrypt`/`hmac`/`datakey`,
crée une clé par sortie et, pour l'effacement, positionne `deletion_allowed` puis
supprime la clé (`DELETE`). La politique ci-dessous accorde exactement cela, et rien
d'autre.

### 1a. Stockage persistant et vrai scellement

Remplacez le conteneur de dev par un serveur configuré. `vault.hcl` minimal :

```hcl
storage "raft" {
  path    = "/vault/data"
  node_id = "vault-1"
}

listener "tcp" {
  address       = "0.0.0.0:8200"
  tls_cert_file = "/vault/tls/cert.pem"
  tls_key_file  = "/vault/tls/key.pem"
}

# Descellement automatique pour qu'un redémarrage ne demande pas d'humain. Choisissez UN
# mécanisme que votre organisation exploite déjà (KMS cloud, HSM, ou Transit d'un Vault
# *séparé*). Sans lui, chaque redémarrage bloque sur `vault operator unseal`.
seal "awskms" {
  region     = "eu-west-1"
  kms_key_id = "..."
}
```

Montez `/vault/data` et `/vault/tls` sur de vrais volumes. Le TLS est obligatoire :
l'API envoie le jeton et des clés de données (DEK) en clair sur ce socket.

Initialisez **une seule fois** :

```bash
vault operator init -key-shares=5 -key-threshold=3
```

Conservez les clés de descellement/récupération et le jeton root initial **hors ligne,
répartis entre plusieurs personnes**. Le jeton root ne sert pas au quotidien : il existe
pour l'amorçage et les situations d'urgence.

### 1b. Un jeton restreint pour l'API (pas root)

Écrivez la politique dont l'API a réellement besoin :

```hcl
# transit-app.hcl  — le point de montage est VAULT_TRANSIT_MOUNT (par défaut "transit")
path "transit/keys/trip-*"          { capabilities = ["create", "read", "update"] }
path "transit/keys/trip-*/config"   { capabilities = ["update"] }              # deletion_allowed
path "transit/keys/trip-*"          { capabilities = ["delete"] }              # LA suppression d'effacement
path "transit/encrypt/trip-*"       { capabilities = ["update"] }
path "transit/decrypt/trip-*"       { capabilities = ["update"] }
path "transit/hmac/trip-*"          { capabilities = ["update"] }
path "transit/datakey/plaintext/trip-*" { capabilities = ["update"] }
path "sys/mounts/transit"           { capabilities = ["create", "read", "update"] } # ensureTransitEngine au démarrage
```

```bash
vault policy write transit-app transit-app.hcl
```

Préférez **AppRole** à un jeton créé à la main, pour pouvoir renouveler l'identifiant :

```bash
vault auth enable approle
vault write auth/approle/role/trip-api \
  token_policies=transit-app token_ttl=1h token_max_ttl=4h secret_id_ttl=24h
vault read  auth/approle/role/trip-api/role-id           # -> VAULT_ROLE_ID
vault write -f auth/approle/role/trip-api/secret-id       # -> VAULT_SECRET_ID
```

Aujourd'hui, l'API lit un `VAULT_TOKEN` statique. Deux façons de faire :

- **Simple :** créez un jeton périodique rattaché à la politique et mettez-le dans
  `VAULT_TOKEN` ; renouvelez-le régulièrement (`vault token renew`) ou remplacez la valeur
  de `.env`.
  ```bash
  vault token create -policy=transit-app -period=24h -orphan   # copier .auth.client_token
  ```
- **Recommandé :** lancez [Vault Agent](https://developer.hashicorp.com/vault/docs/agent-and-proxy/agent)
  à côté de l'API pour la connexion AppRole et le renouvellement automatique, en écrivant
  le jeton dans un tmpfs partagé que l'API lit comme `VAULT_TOKEN`. Le secret durable
  (role-id/secret-id) reste hors de l'application et les jetons sont de courte durée.

Dans les deux cas : **révoquez le jeton root** une fois l'amorçage terminé
(`vault token revoke <root>`) ; ne le régénérez avec les clés de descellement qu'en cas
d'urgence.

### 1c. Journal d'audit

Activez un journal d'audit pour que la création et surtout la destruction des clés soient
attribuables :

```bash
vault audit enable file file_path=/vault/logs/audit.log
```

Le chiffré transit n'est pas journalisé, mais le HMAC des corps de requête l'est.
Envoyez ces journaux vers votre agrégateur existant ; **ne les stockez pas** avec la
sauvegarde du stockage de Vault.

---

## 2. Sauvegardes et garantie d'effacement

| Stockage | Contient | Sauvegarder ? | Sûreté d'une restauration après effacement |
|---|---|---|---|
| **Postgres** | données personnelles chiffrées, HMAC `email_lookup`, résultats sans données personnelles | Oui | Sûre — illisible sans la clé de la sortie |
| **MinIO** | photos chiffrées par enveloppe + DEK enveloppées | Oui | Sûre — les DEK sont enveloppées par la clé de la sortie |
| **Stockage Vault** | les clés des sorties elles-mêmes | **À part, sous contrôle strict** | **C'est la frontière de l'effacement** |

Règles :

1. Les sauvegardes Postgres et MinIO peuvent partager une même chaîne. Elles ne
   contiennent **que du chiffré** : une sauvegarde volée ou ancienne est inerte une fois la
   clé détruite.
2. **Les sauvegardes du stockage Vault sont ailleurs**, avec leur propre durée de
   conservation, courte, et leur propre liste d'accès. Une sauvegarde Postgres de la
   semaine dernière + une sauvegarde Vault de la semaine dernière = la récupération
   complète d'une sortie que vous croyiez « effacée ». C'est exactement l'échec que toute
   cette conception veut empêcher.
3. Après un effacement, une sauvegarde Postgres/MinIO antérieure contiendra toujours les
   lignes chiffrées, mais elles sont **indéchiffrables** : la clé a disparu du Vault en
   production et (selon la règle 2) de toute sauvegarde Vault que vous restaureriez
   réellement. C'est cela, la garantie.

**Prouvez-le en préproduction** avant de vous y fier : créez une sortie, envoyez une
photo, lancez l'effacement, puis restaurez la sauvegarde Postgres+MinIO de la veille et
vérifiez que la photo ne se déchiffre pas (la clé de la sortie est absente).
Documentez le résultat.

---

## 3. Secrets et réseau

- `SESSION_SECRET` — 64 octets aléatoires, propres à chaque déploiement. Le changer
  invalide toutes les sessions enseignants (acceptable : ils se reconnectent via OIDC).
  Les élèves gardent leurs sessions liées à l'appareil.
- `APP_BIND_ADDR` — liez l'application à l'**IP WireGuard/VPN**, jamais à `0.0.0.0`.
  Postgres, MinIO et Vault restent sur le réseau interne de compose, **sans aucun port
  publié** en production (la publication de ports de `docker-compose.dev.yml` est réservée
  au dev).
- Le TLS et les en-têtes de sécurité (HSTS, CSP) sont terminés par **Traefik**
  (`traefik/dynamic.yml`). Les cookies ne sont `Secure` qu'avec `NODE_ENV=production` :
  la production **doit** donc le définir.
- `/api/auth/teacher/dev-login` refuse de fonctionner si `NODE_ENV` vaut `production`.
  Vérifiez qu'il répond 404/403 en production (avec `curl`, dans votre test de fumée).

---

## 4. Antivirus sur les envois

Définissez `AV_SCAN_ENABLED=true` et faites tourner le service `clamav` fourni. Les envois
sont **refusés en cas de panne** : si clamd est injoignable, l'API répond
`503 scan_unavailable` plutôt que de stocker un fichier non analysé. Deux conséquences :

- clamd doit être opérationnel avant que l'API accepte des envois.
  `depends_on: service_healthy` s'en charge au démarrage ; surveillez-le ensuite — clamd
  arrêté, plus d'envois.
- Les signatures doivent rester à jour. L'image `clamav/clamav` lance `freshclam` ;
  assurez-vous que le volume `clamav_data` persiste et que le conteneur peut joindre les
  miroirs CVD (ou un miroir privé) pour mettre à jour les définitions.

Vérifiez de bout en bout avec la chaîne de test EICAR : un fichier contenant
`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*` doit être refusé
avec un `422`.

---

## 5. Hygiène des journaux (audit régulier)

Aucune donnée personnelle d'élève ne doit atteindre les journaux. Le code tient cette
ligne : en cas d'échec, l'envoi des codes ne stocke qu'un **code/nom** d'erreur, jamais
l'adresse ; les lignes d'audit référencent des identifiants, pas des e-mails. Quand vous
ajoutez du code ou modifiez des journaux, revérifiez : **aucun e-mail, nom ou code
d'accès dans un journal ou un message d'erreur.** Une fuite ici met l'effacement en échec
(les journaux survivent à la clé).

Appliqué dans le code et les tests (`packages/api/src/lib/logging.ts`, `test/logging.test.ts`) :

- les URL de requête sont journalisées **sans leur query string** (jetons d'invitation, identifiants) ;
- les clés `email` / `code` sont masquées à toute profondeur, ainsi que les cookies et `Authorization` ;
- un e-mail de code d'accès en échec ne journalise que le **code** d'erreur SMTP (les
  erreurs SMTP répètent le destinataire) ;
- avec `NODE_ENV=production` et sans `SMTP_HOST`, le mailer **refuse** d'envoyer au lieu
  d'afficher le message (ce qui journaliserait des codes d'accès).

### Erreurs et identifiants de requête (#69)

(Les auto-vérifications au démarrage et `/api/readyz` sont décrits dans
`docs/deployment.md` § 4–5. Un Vault scellé y apparaît comme `"keystore":"sealed"`.)

Chaque erreur de l'API répond `{ error, message, requestId }` ; le même identifiant est
dans l'en-tête de réponse `X-Request-Id` et sur chaque ligne de journal sous `reqId`.
L'API reprend le `X-Request-Id` du frontal s'il est court et simple (`[A-Za-z0-9._:-]`,
64 caractères au plus), sinon elle génère un UUID. Pour l'activer dans Traefik, ajoutez le
plugin request-id ou un middleware d'en-tête ; sans cela, les identifiants naissent dans
l'API.

Les codes d'erreur (`error`) restent stables et en anglais ; seul le `message`, affiché
tel quel par l'application, est en français.

**Retrouver un signalement :** l'application affiche « Référence : <id> ». Cherchez
`"reqId":"<id>"` dans les journaux de l'API. La ligne 5xx contient `route` (le motif, par
ex. `/api/trips/:id/erase`, jamais l'URL), `status`, `dependency` et `errorCode`.

| Réponse | Signification | Où regarder |
|---|---|---|
| 503 `storage_unavailable` | S3/MinIO en échec (réseau, `AccessDenied`, `NoSuchBucket`…) | `errorCode`, politique du bucket, état de MinIO |
| 503 `keystore_unavailable` | Vault injoignable, scellé, ou jeton refusé (403) | `vault status`, TTL/politique du jeton (§ 1) |
| 503 `database_unavailable` | Postgres a refusé ou coupé la connexion | état de Postgres, limite de connexions |
| 500 `internal_error` | Un bug : le client ne voit aucun détail | le `err.stack` de la ligne de journal |

Les 5xx sont journalisées en `error`. Les 403 et 429 en `warn` (sondage, ou une classe qui
sollicite fortement l'API). Les autres erreurs client n'apparaissent que dans le journal
des requêtes. Les journaux d'erreur contiennent le nom, le message, le code et la pile de
l'erreur, mais **pas** l'objet d'erreur brut du pilote : Postgres met des valeurs de
lignes dans `detail`.

Comme l'application ne journalise jamais de données personnelles, l'effacement n'a pas
d'étape de nettoyage des journaux : côté application, il n'y a rien à nettoyer. Le seul
résidu que l'effacement *ne peut pas* atteindre, ce sont les **journaux de distribution
de votre relais SMTP externe** : les relais enregistrent généralement les adresses des
destinataires, et l'application n'y a aucun accès. C'est une **responsabilité de
l'exploitant** :

- Configurez le relais pour **ne pas** conserver les journaux de messages/destinataires
  au-delà du nécessaire, et faites-les tourner sur une période plus courte que la durée de
  vie d'une sortie. Une adresse d'élève restée dans les journaux du relais après la
  destruction de la clé de sa sortie est une fuite résiduelle qui met l'effacement
  cryptographique en échec.
- Préférez un relais que vous maîtrisez (ou un sous-traitant lié par contrat) à une API
  tierce dont vous ne pouvez pas régler la durée de conservation.

---

## 6. Effacement d'urgence à la demande

L'effacement se déclenche normalement tout seul après le délai de grâce (ou la date
butoir de la sortie). Pour le forcer immédiatement (incident, retrait du consentement,
envoi erroné) :

- **Par sortie, dans l'application :** enseignant → sortie → Paramètres → **Effacer
  maintenant** (double confirmation). Cela passe par le même chemin `destroyTripKey`.
- **Par sortie, à la main** (application arrêtée) : détruisez directement la clé — c'est
  irréversible et rend immédiatement illisible tout le chiffré de cette sortie, où qu'il
  se trouve :
  ```bash
  vault write transit/keys/trip-<TRIP_ID>/config deletion_allowed=true
  vault delete transit/keys/trip-<TRIP_ID>
  ```
  Supprimez ensuite les lignes de la sortie (désormais du chiffré inerte) quand cela vous
  convient.
- **Urgence sur tout le déploiement :** détruire le stockage de Vault (et sa sauvegarde
  hors site) efface **toutes** les sorties d'un coup. À réserver à une compromission.

Après tout effacement, vérifiez que la clé a disparu (`vault read transit/keys/trip-<ID>`
→ 404) et que les photos correspondantes ne se déchiffrent plus.
