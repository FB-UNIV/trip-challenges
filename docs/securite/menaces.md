# Modèle de menaces

Ce qui pourrait mal tourner, et ce qui est en place pour l'empêcher ou en limiter les
dégâts. Chaque scénario indique les **protections** existantes et le **risque résiduel** —
ce qu'aucune mesure technique du logiciel ne couvre, et qui relève de l'exploitation ou de
l'organisation.

::: info Vous avez trouvé une faille ?
Ne la publiez pas : utilisez le [signalement privé](https://github.com/FB-UNIV/trip-challenges/security/advisories/new)
(voir la [politique de sécurité](https://github.com/FB-UNIV/trip-challenges/security/policy)).
:::

## Ce qu'on protège

| Bien | Pourquoi c'est sensible |
|---|---|
| **Photos** | Des visages de mineurs, des lieux. La donnée la plus sensible. |
| **Adresses e-mail des élèves** | Identifient un mineur ; la seule donnée d'identité stockée. |
| **Noms d'équipe** | Texte libre, souvent des prénoms (« Léa & Tom 4B »). |
| **Votes** | Qui a voté pour quoi (jamais montré à personne). |
| **Comptes enseignants** | Accès à toutes les photos et adresses de leurs sorties, et à l'effacement. |
| **Clés Vault** | Déchiffrent tout ; leur destruction *est* l'effacement. |

## Qui pourrait attaquer

- **Un inconnu sur internet** — balayage automatisé, curiosité, rançongiciel.
- **Un élève** (de la sortie ou d'une autre) — curiosité, blague, harcèlement.
- **Une personne de l'entourage** — parent, ex-élève, qui connaît une adresse e-mail ou a
  accès à un téléphone.
- **Un enseignant ou un personnel** — erreur ou malveillance (menace interne).
- **Un tiers de la chaîne technique** — hébergeur, relais e-mail, dépendance logicielle.

## 1. Comptes et sessions

| Scénario | Protections | Risque résiduel / recommandations |
|---|---|---|
| **Deviner ou forcer un code d'accès** | Code aléatoire de 128 bits, haché avec argon2 ; 5 essais par minute et par code ; réponse identique pour un code inconnu, déjà utilisé ou faux. | Négligeable. |
| **Lien d'accès intercepté ou transféré** (e-mail lu par un tiers, lien collé dans un groupe) | Usage unique : le premier qui l'ouvre est connecté, le lien ne sert plus. | Si un tiers l'utilise en premier, l'élève le constate (« déjà utilisé ») et demande un nouveau code, ce qui déconnecte le tiers. Préférez des adresses de l'ENT aux adresses personnelles. |
| **Boîte mail de l'élève compromise** | Les codes ne valent que pour une sortie et jusqu'à son effacement. | Celui qui lit la boîte peut demander un nouveau code et prendre la place de l'élève. Hors de portée du logiciel. |
| **Téléphone d'élève perdu ou volé** | Session liée à l'appareil ; un nouveau code révoque l'ancienne session. | La session n'expire pas d'elle-même avant l'effacement : quiconque tient le téléphone déverrouillé agit comme l'élève (voir les photos de son équipe, voter). L'élève doit demander un nouveau code rapidement. |
| **Savoir si une adresse participe à une sortie** (énumération) | Le formulaire « nouveau code » répond toujours la même chose, que l'adresse existe ou non. | Négligeable. |
| **Inonder une adresse de demandes de code** | 20 demandes par minute et par adresse IP. | Un attaquant disposant de nombreuses IP peut envoyer des rafales d'e-mails à un élève et dégrader la réputation du relais. Surveillez le volume du relais. |
| **Compte enseignant compromis** (mot de passe volé, poste partagé) | Connexion déléguée au fournisseur d'identité de l'établissement (MFA/passkeys possibles) ; session limitée à 8 h côté serveur ; cookie `HttpOnly`, `Secure`, `SameSite=Strict`. | Impact élevé : toutes les photos et adresses de ses sorties, et la possibilité d'effacer. Exigez la MFA ; en cas de doute, désactivez le compte et changez `SESSION_SECRET`. |
| **N'importe quel compte du fournisseur d'identité devient enseignant** | — | L'application n'a pas de liste d'enseignants autorisés : tout compte qui se connecte peut créer des sorties (mais ne voit que les siennes). Restreignez les comptes du fournisseur d'identité. |
| **Porte dérobée de développement** (`/dev-login`, connexion sans mot de passe) | Absente quand `NODE_ENV=production`, que le `docker-compose.yml` de production impose. | Ne pas retirer cette ligne ; vérifier que la route répond 404 en production. |
| **Falsification de requêtes intersites (CSRF)** | Cookies `SameSite=Strict`, API en JSON. | Négligeable. |

## 2. Accès aux données d'autrui

| Scénario | Protections | Risque résiduel / recommandations |
|---|---|---|
| **Un élève ou un enseignant accède à une autre sortie** | Chaque route vérifie rôle, sortie et phase ; une ressource d'une autre sortie répond « introuvable » ; un test automatique échoue si une route n'est pas protégée. | Dépend de la qualité du code ; signalez toute anomalie. |
| **Un élève voit les photos d'une autre équipe avant le vote** | Une photo n'est servie qu'à son équipe, aux enseignants de la sortie, et — pendant le vote et la révélation seulement — aux élèves de la sortie si elle est sélectionnée **et** validée. | — |
| **Captures d'écran pendant le vote** | Les photos sont montrées sans nom ; jamais mises en cache (`no-store`). | **Impossible à empêcher techniquement.** Cadre éducatif : charte, consignes, modération préalable. |
| **Résultats publiés** | Avant la publication, seuls les enseignants les voient ; ils ne contiennent ni photo ni identité d'élève. | Une fois publiés, ils sont lisibles par quiconque connaît l'identifiant de la sortie, y compris les noms d'équipe vérifiés : vérifiez les noms. |
| **Contenu des défis** | — | Le titre et les consignes d'un défi sont lisibles par quiconque scanne son QR code (le QR est affiché dans des lieux publics). N'y mettez aucune donnée personnelle. |
| **Enseignant malveillant** | Il ne voit que ses sorties ; ses actions sensibles (retraits, effacements, renvois de codes…) sont au journal d'audit. | Il voit toutes les photos et adresses de sa sortie, peut l'effacer, et un co-enseignant a les mêmes droits. Les consultations ne sont pas tracées. Limitez les comptes ; cadre déontologique. |

## 3. Contenus envoyés

| Scénario | Protections | Risque résiduel / recommandations |
|---|---|---|
| **Photo inappropriée ou illégale** | Rien n'est montré aux autres équipes sans validation ; tout enseignant de la sortie peut retirer n'importe quelle photo à tout moment. | Les membres de l'équipe la voient. Modérez tôt ; en cas de contenu illégal, suivez la procédure de l'établissement. |
| **Fichier piégé** (virus, fichier polyglotte) | Analyse antivirus **avant** stockage, refus si l'antivirus est indisponible ; l'image est décodée puis ré-encodée en JPEG, ce qui élimine les contenus cachés et les métadonnées. | Dépend de `AV_SCAN_ENABLED=true` et de signatures à jour. |
| **Fuite de la position via les métadonnées** | Toutes les métadonnées (EXIF, GPS) sont supprimées au ré-encodage. | Le décor de la photo peut lui-même révéler un lieu. |
| **Image « bombe »** (fichier énorme ou dimensions démesurées) | 15 Mo maximum par envoi ; limite de pixels du décodeur ; images réduites à 2000 px. | Une rafale d'envois coûteux peut ralentir le serveur ; limites de débit par élève et par IP. |
| **Injection de script** (XSS) via un nom d'équipe ou un titre | L'interface n'insère jamais de HTML brut ; CSP `script-src 'self'`. | Nécessite les en-têtes du frontal (fournis pour Traefik ; à reproduire pour Caddy). |

## 4. Infrastructure

| Scénario | Protections | Risque résiduel / recommandations |
|---|---|---|
| **Serveur applicatif compromis** | Données chiffrées au repos ; journaux sans données personnelles. | **Le système en fonctionnement sait déchiffrer les sorties en cours** : un attaquant qui contrôle le serveur peut les lire. Seules les sorties déjà effacées sont hors d'atteinte. Mises à jour, accès restreints, surveillance ; en cas de compromission, détruire les clés des sorties en cours. |
| **Vol d'une sauvegarde de la base ou du stockage** | Elles ne contiennent que du chiffré ; les clés sont dans Vault. | Sûr **si** les sauvegardes de Vault sont séparées. |
| **Sauvegardes de Vault mélangées aux autres** | Règle d'exploitation documentée. | Ruine la garantie d'effacement : une sauvegarde complète restaure une sortie « effacée ». Vérifiez le plan de sauvegarde. |
| **Vault laissé en mode dev** | Le guide de durcissement l'interdit pour de vraies données. | Clés en mémoire (perdues au redémarrage) et jeton root dans `.env`. |
| **Relais e-mail** | Seuls les codes et alertes passent par lui. | Il conserve les adresses dans ses journaux, hors de portée de l'effacement. Réglez sa rétention. |
| **Services exposés par erreur** | Seuls `web` et `api` sont publiés, sur `APP_BIND_ADDR`. | `APP_BIND_ADDR=0.0.0.0` ou un pare-feu absent exposent l'API sans les en-têtes du frontal. |
| **Usurpation d'adresse IP via le proxy** | Seuls les proxys de `TRUST_PROXY` (réseaux privés par défaut) peuvent fournir `X-Forwarded-For`. | Une API joignable sans passer par le frontal permettrait de contourner les limites par IP. |
| **HTTP sans TLS** | Cookies `Secure` en production : sans HTTPS, la connexion ne fonctionne pas. | — |

## 5. Disponibilité

| Scénario | Effet | Recommandations |
|---|---|---|
| Afflux de requêtes (volontaire ou non) | Limites de débit : 6000/min par IP (une classe partage souvent une IP), 600/min par élève. | Un déni de service par volume n'est pas couvert par le logiciel ; protection réseau de l'hébergeur. |
| Vault indisponible ou scellé | Plus rien ne se déchiffre : l'application est inutilisable. | Descellement automatique, supervision de `/api/readyz`. |
| Antivirus arrêté | Envois refusés (par sécurité). | Supervision du conteneur `clamav`. |
| Fournisseur d'identité arrêté | Les enseignants ne peuvent plus se connecter (les élèves, si). | — |

## 6. Effacement

| Scénario | Protections | Risque résiduel / recommandations |
|---|---|---|
| **Personne ne pense à effacer** | Effacement automatique après le délai de grâce, et date butoir forcée quelle que soit la phase ; alertes aux enseignants avant. | — |
| **L'effacement échoue** (Vault ou stockage en panne) | Nouvelle tentative chaque minute, alerte e-mail aux enseignants et à `ALERT_EMAIL`, sonde `HEARTBEAT_URL`. | Tant qu'il n'a pas abouti, les données existent. Traitez l'alerte. |
| **Effacement malveillant ou par erreur** | Confirmation en tapant le nom de la sortie ; tracé au journal d'audit. | Irréversible par conception : aucune restauration possible. |
| **Copies hors du système** | — | Captures d'écran, photos transférées depuis les téléphones, e-mails dans les boîtes des élèves, journaux du relais : hors de portée de l'effacement. |

## 7. Chaîne logicielle

| Scénario | Protections | Risque résiduel / recommandations |
|---|---|---|
| **Dépendance compromise ou vulnérable** | Alertes Dependabot, analyse CodeQL, tests à chaque modification. | Mettez à jour régulièrement ; suivez les avis de sécurité du dépôt. |
| **Image Docker falsifiée** | Images publiées signées (cosign, sans clé), avec SBOM et provenance. | Vérifiez la signature avant de déployer ; ou construisez vous-même depuis les sources. |
| **Compte d'un mainteneur compromis** | Modifications de `main` uniquement par PR avec vérifications obligatoires. | Une version malveillante resterait signée par le workflow officiel : lisez les notes de version. |

## Ce que l'effacement garantit — et ne garantit pas

**Il garantit** qu'une fois la clé d'une sortie détruite, aucune donnée de cette sortie ne
peut plus être lue depuis le système **ni depuis ses sauvegardes**, à condition que les
sauvegardes de Vault soient séparées des autres.

**Il ne garantit pas** la confidentialité **pendant** la sortie face à un serveur compromis,
ni le sort des copies faites hors du système (captures, téléchargements, boîtes mail,
journaux du relais).

Pour aller plus loin : [ADR 0001](../adr/0001-crypto-erasure-with-vault-per-trip-keys.md),
[durcissement](../production-hardening.md), [guide du DPO](../roles/dpo.md).
