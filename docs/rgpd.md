# RGPD — guide pour les établissements

> ⚠️ **Projet à faire valider par le délégué à la protection des données (DPO) de votre
> établissement ou de votre académie.** Ce document décrit fidèlement ce que fait le
> logiciel ; les choix juridiques (base légale, nécessité d'une AIPD, contrats) relèvent de
> l'établissement, responsable de traitement. Ce n'est pas un avis juridique.

Ce guide aide un établissement à documenter l'usage de Trip Challenges : qui est
responsable de quoi, quelles données sont traitées et combien de temps, et comment en
informer les familles. Le détail technique est dans [`CONTEXT.md`](../CONTEXT.md),
[`data-model.md`](./data-model.md) et les ADR
[0001](./adr/0001-crypto-erasure-with-vault-per-trip-keys.md) (effacement cryptographique),
[0004](./adr/0004-roster-import-school-as-controller.md) (rôles) et
[0007](./adr/0007-team-names-survive-erasure-only-if-reviewed.md) (noms d'équipe).

Les élèves disposent dans l'application d'une page « Tes données et ta vie privée »
(`/confidentialite`), accessible depuis tous les écrans, qui résume ces informations.

## 1. Rôles

| Acteur | Rôle RGPD | Remarques |
|---|---|---|
| **L'établissement** (via ses enseignants) | **Responsable de traitement** | Décide de l'usage, importe la liste d'élèves, détient les autorisations des familles (ADR-0004). |
| **L'exploitant** qui héberge l'instance | Sous-traitant, s'il est distinct de l'établissement | Collectivité, académie, prestataire… Un contrat de sous-traitance (art. 28 RGPD) est alors nécessaire. |
| **Les fournisseurs de l'exploitant** (hébergeur, stockage S3, relais SMTP) | Sous-traitants ultérieurs | À lister dans le contrat ; privilégier un hébergement dans l'Union européenne. |
| Les auteurs du logiciel | Aucun | Le logiciel est auto-hébergé : ils n'ont accès à aucune donnée. |

## 2. Fiche de traitement (base pour votre registre)

| Rubrique | Contenu |
|---|---|
| **Finalité** | Organiser des défis photo pendant une sortie scolaire : équipes, envoi de photos, vote entre élèves, cérémonie des résultats. |
| **Base légale** | **À déterminer par l'établissement.** Pistes usuelles : mission d'intérêt public (art. 6-1-e) pour une activité pédagogique ; consentement des représentants légaux si l'activité est facultative. Les photos où un élève est reconnaissable relèvent en outre du droit à l'image : recueillez l'autorisation des familles comme pour toute captation. |
| **Personnes concernées** | Élèves (mineurs) participant à la sortie ; enseignants organisateurs. |
| **Données des élèves** | Adresse e-mail (chiffrée) ; photos (chiffrées, métadonnées et position GPS supprimées à l'envoi) ; appartenance à une équipe et nom d'équipe choisi par les élèves (chiffré) ; votes (duels) ; jeton de session de l'appareil (haché). Aucun nom, prénom, date de naissance ni classe n'est demandé. |
| **Données des enseignants** | Identité issue du fournisseur OIDC de l'établissement (identifiant, e-mail, nom affiché) ; journal d'audit de leurs actions. |
| **Destinataires** | Enseignants de la sortie (toutes les photos, e-mails des élèves, statut, équipes ; nombre de votants, jamais le détail des votes). Autres élèves de la sortie : uniquement les photos sélectionnées et validées, pendant le vote, sans nom. Aucun destinataire extérieur. |
| **Durée de conservation** | Effacement automatique après la cérémonie et un délai de grâce réglé par l'enseignant (7 jours par défaut), et **au plus tard** à la date de fin de sortie + la durée de conservation maximale (30 jours par défaut), quelle que soit la phase. Un enseignant peut effacer plus tôt. |
| **Ce qui subsiste** | Les résultats (titre du défi, place, points, nom d'équipe s'il a été vérifié par un enseignant, sinon « Équipe N ») et le journal d'audit des enseignants. Aucune photo, aucune donnée d'élève. |
| **Transferts hors UE** | Aucun par le logiciel. Dépend des fournisseurs choisis par l'exploitant (stockage, SMTP). |
| **Mesures de sécurité** | Chiffrement de chaque sortie sous sa propre clé (Vault) ; effacement par destruction de la clé, qui rend les sauvegardes illisibles ; analyse antivirus des envois ; suppression des métadonnées des photos ; codes d'accès à usage unique ; connexion des enseignants via l'OIDC de l'établissement ; journaux sans données personnelles ; aucun cookie de pistage ni mesure d'audience. Voir [`production-hardening.md`](./production-hardening.md). |

## 3. Analyse d'impact (AIPD)

Le traitement porte sur des **personnes vulnérables (mineurs)** et sur des **photos** ;
selon les critères de la CNIL, une AIPD peut être requise. Évaluez-le avec votre DPO. Les
éléments ci-dessus (minimisation, chiffrement, effacement vérifiable, absence de
profilage et de suivi individuel) sont la matière principale de l'analyse.

## 4. Exercice des droits

Les demandes (accès, rectification, effacement, opposition) sont adressées à
l'établissement, responsable de traitement. Les moyens disponibles dans l'application :

- **Rectification de l'adresse** : un enseignant corrige une adresse non distribuée
  (page Élèves de la sortie).
- **Retrait d'une photo** : un enseignant peut retirer n'importe quelle photo, à tout
  moment.
- **Effacement** : l'effacement porte sur toute la sortie ; un enseignant peut le
  déclencher à tout moment (Paramètres → « Effacer toutes les données des élèves »).
  L'effacement des données d'un seul élève avant la fin de la sortie n'est pas proposé dans
  l'interface : retirez ses photos et, si nécessaire, effacez la sortie plus tôt.

## 5. Points de vigilance pour l'exploitant

- **Journaux du relais SMTP** : ils contiennent les adresses des destinataires et
  échappent à l'effacement. Limitez leur conservation à une durée inférieure à celle d'une
  sortie ([durcissement § 5](./production-hardening.md#5-hygiène-des-journaux-audit-régulier)).
- **Sauvegardes de Vault** : elles doivent rester séparées de celles de la base, sinon
  l'effacement n'est pas effectif
  ([durcissement § 2](./production-hardening.md#2-sauvegardes-et-garantie-deffacement)).
- **Noms d'équipe** : vérifiez-les (page Élèves) avant la révélation ; seuls les noms
  vérifiés survivent à l'effacement.

## 6. Modèle de note d'information aux familles

À adapter et compléter (les passages entre crochets) avant diffusion.

---

**Objet : défis photo pendant la sortie [nom de la sortie]**

Madame, Monsieur,

Pendant la sortie [nom de la sortie] du [dates], la classe de votre enfant participera à des
défis photo à l'aide de l'application Trip Challenges, hébergée par [nom de l'exploitant].

**Ce qui est utilisé.** L'adresse e-mail de votre enfant [adresse de l'ENT / adresse
personnelle], pour lui envoyer un code d'accès ; les photos prises par son équipe ; le nom
de son équipe ; ses votes. Aucun autre renseignement n'est demandé. Il n'y a ni publicité
ni pistage.

**Qui y a accès.** Les enseignants organisateurs. Les autres élèves ne voient que la photo
choisie par chaque équipe et validée par un enseignant, sans nom.

**Combien de temps.** Toutes les données (adresses, photos, équipes, votes) sont
**définitivement effacées** [7] jours après la cérémonie des résultats, et au plus tard le
[date butoir]. Seul subsiste le palmarès (défi, place, points, nom d'équipe vérifié par un
enseignant), sans aucune photo ni nom d'élève.

**Base légale.** [À compléter par l'établissement.]

**Vos droits.** Vous pouvez demander l'accès, la rectification ou l'effacement des données
de votre enfant auprès de [contact : enseignant référent / secrétariat] ou du délégué à la
protection des données : [contact du DPO]. Vous pouvez aussi adresser une réclamation à la
CNIL (www.cnil.fr).

[Signature]
