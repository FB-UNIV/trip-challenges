# Guide du DPO et du référent sécurité des données

Vous accompagnez l'établissement (responsable de traitement) et contrôlez l'hébergeur.
Cette page rassemble ce qu'il faut vérifier, avec pour chaque garantie **où elle est mise en
œuvre** et **comment la contrôler**.

- La fiche de traitement, l'AIPD et le modèle de note aux familles : [fiche RGPD](../rgpd.md).
- Les risques, scénario par scénario : [modèle de menaces](../securite/menaces.md).

## Le traitement en bref

| | |
|---|---|
| **Responsable** | L'établissement ([ADR 0004](../adr/0004-roster-import-school-as-controller.md)) |
| **Sous-traitant** | L'hébergeur, s'il est distinct (contrat art. 28) |
| **Personnes** | Élèves mineurs ; enseignants |
| **Données élèves** | E-mail, photos, équipe et son nom, votes, jeton de session |
| **Durée** | Délai de grâce après la cérémonie (7 j par défaut) ; au plus tard fin de sortie + 30 j (par défaut) |
| **Subsiste** | Résultats (défi, place, points, nom d'équipe vérifié ou « Équipe N ») ; journal d'audit des enseignants |

## Les garanties techniques et leur contrôle

| Garantie | Mise en œuvre | Comment la vérifier |
|---|---|---|
| **Chiffrement au repos par sortie** | E-mails et noms d'équipe chiffrés par Vault ; photos chiffrées par enveloppe sous la clé de la sortie ([ADR 0001](../adr/0001-crypto-erasure-with-vault-per-trip-keys.md), [modèle de données](../data-model.md#frontière-du-chiffrement-clé-de-la-sortie)) | Demander à l'hébergeur un extrait de la base : les colonnes `email_enc`, `name_enc` sont illisibles ; le bucket ne contient que du chiffré. |
| **Effacement vérifiable** | Destruction de la clé Vault de la sortie, qui rend illisible toute copie, sauvegardes comprises | Exiger le test décrit au [durcissement § 2](../production-hardening.md#2-sauvegardes-et-garantie-deffacement) : restaurer une sauvegarde antérieure à un effacement et constater que les photos ne se déchiffrent pas. |
| **Effacement même en cas d'oubli** | Date butoir forcée quelle que soit la phase ; nouvelles tentatives chaque minute en cas d'échec, alertes e-mail, sonde de surveillance | Demander la configuration `ALERT_EMAIL` / `HEARTBEAT_URL` de l'hébergeur. |
| **Séparation des sauvegardes** | Règle d'exploitation : stockage Vault sauvegardé à part | Demander le plan de sauvegarde écrit. **C'est le point le plus important.** |
| **Minimisation** | Seul l'e-mail identifie un élève ; métadonnées et GPS retirés des photos (ré-encodage) ; pas de « vu pour la dernière fois », pas de suivi individuel | [ADR 0006](../adr/0006-teachers-read-student-emails-back.md) |
| **Pas de données personnelles dans les journaux** | Masquage des `email`/`code`, URL sans paramètres, erreurs SMTP réduites à leur code ; testé automatiquement | [durcissement § 5](../production-hardening.md#5-hygiène-des-journaux-audit-régulier) |
| **Noms d'équipe** | Seuls les noms vérifiés par un enseignant survivent à l'effacement | [ADR 0007](../adr/0007-team-names-survive-erasure-only-if-reviewed.md) |
| **Cloisonnement** | Chaque route vérifie le rôle, la sortie et la phase ; un test échoue si une route n'est pas protégée | Code : `packages/api/src/auth/guard.ts`, `test/guard.test.ts` |
| **Antivirus** | Chaque envoi est analysé avant stockage ; refusé si l'antivirus est indisponible | Fichier de test EICAR refusé ([durcissement § 4](../production-hardening.md#4-antivirus-sur-les-envois)) |
| **Pas de pistage** | Aucun script tiers ; un seul cookie de session (élève) ou de connexion (enseignant) | Politique de sécurité du contenu (CSP) `script-src 'self'` |

## Le journal d'audit

Il trace les **actions des enseignants** (et quelques événements système), avec des
identifiants opaques et jamais de donnée personnelle d'élève — c'est pourquoi il survit à
l'effacement. Actions enregistrées :

| Domaine | Actions |
|---|---|
| Sortie | `trip_created`, `trip_config_edited`, `phase_challenge`, `phase_voting`, `phase_reveal`, `phase_grace`, `grand_champion_set` |
| Élèves | `roster_enqueued`, `access_code_resent`, `roster_address_fixed`, `roster_item_retried`, `access_code_reissued` (demande de l'élève) |
| Équipes | `team_renamed`, `team_name_reviewed` |
| Photos | `submission_removed`, `submission_infected_rejected` |
| Enseignants | `coteacher_invited`, `coteacher_joined` |
| Effacement | `erasure_requested`, `erasure_fired` |

Ne sont **pas** tracés : la consultation de la liste des élèves ou des photos, et les
décisions de modération (valider / refuser). Si votre politique exige une traçabilité des
consultations, signalez-le aux mainteneurs.

## Exercice des droits

| Demande | Réponse possible |
|---|---|
| **Accès** | L'enseignant voit l'e-mail, le statut et l'équipe de l'élève ; les photos de l'équipe sont visibles dans l'application. Il n'existe pas d'export automatisé. |
| **Rectification** | Correction d'une adresse non distribuée par l'enseignant ; renommage d'une équipe. |
| **Effacement** | Retrait de photos à tout moment ; effacement de toute la sortie à tout moment. L'effacement des seules données d'un élève en cours de sortie n'est pas proposé dans l'interface. |
| **Opposition** | L'élève peut ne pas utiliser son lien ; l'enseignant peut ne pas l'inscrire. |

## Violation de données

Un incident est de la responsabilité de l'établissement ; l'hébergeur doit vous en avertir
sans délai (clause du contrat de sous-traitance). Notification à la **CNIL sous 72 heures**
si risque (art. 33), information des familles si risque élevé (art. 34).

Éléments propres à ce logiciel pour évaluer la gravité :

- une sortie **déjà effacée** est hors d'atteinte, même si des sauvegardes ont fuité, **à
  condition** que les sauvegardes de Vault aient été séparées ;
- un serveur compromis **pendant** une sortie expose les données de cette sortie : le
  système en fonctionnement sait les déchiffrer ;
- une fuite d'une sauvegarde de base ou de stockage seule (sans Vault) n'expose que du
  chiffré.

L'effacement immédiat d'une sortie (enseignant, ou destruction manuelle de sa clé par
l'administrateur) est le levier de confinement le plus fort.

## Questions à poser à l'hébergeur

1. Vault est-il en mode production, avec un jeton d'API restreint (pas root) ?
2. Où sont sauvegardés Vault d'une part, la base et le stockage d'autre part ? Qui y a accès ?
   Avez-vous fait le test de restauration après effacement ?
3. Combien de temps le relais SMTP conserve-t-il ses journaux ?
4. L'antivirus est-il actif (`AV_SCAN_ENABLED=true`) ?
5. Qui peut se connecter au fournisseur d'identité (et donc créer des sorties) ? La MFA
   est-elle exigée ?
6. Où sont hébergés serveurs, stockage et relais e-mail (Union européenne ?) ; quels
   sous-traitants ultérieurs ?
7. Comment êtes-vous alerté d'un effacement en échec ? D'une nouvelle version de sécurité ?
