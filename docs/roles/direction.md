# Guide du chef d'établissement

Quand vos enseignants utilisent Trip Challenges, **l'établissement est responsable de
traitement** des données des élèves (RGPD). Ce guide liste ce que vous décidez, ce que vous
devez organiser, et ce que le logiciel garantit — ou non.

## Ce que le logiciel garantit

- **Minimisation** : la seule donnée d'identité d'un élève est son adresse e-mail. Pas de
  nom, pas de date de naissance, pas de classe, pas de géolocalisation (la position GPS est
  retirée des photos).
- **Cloisonnement** : chaque sortie est isolée ; un enseignant ne voit que ses sorties, un
  élève que la sienne.
- **Effacement vérifiable** : tout est effacé après la sortie, y compris les copies dans
  les sauvegardes, par destruction de la clé de chiffrement de la sortie. Une date butoir
  (fin de sortie + 30 jours par défaut) s'applique même si personne n'y pense.
- **Pas de tiers** : aucune publicité, aucun pistage, aucun service externe autre que ceux
  choisis par votre hébergeur (stockage, envoi d'e-mails).

## Ce que le logiciel ne peut pas garantir

- La **qualité de l'hébergement** : un serveur mal configuré ou mal sauvegardé affaiblit
  l'effacement. C'est le rôle de l'[administrateur](./administrateur.md), à qui vous
  pouvez demander la [liste de contrôle](./administrateur.md#liste-de-contrôle-avant-la-première-sortie).
- **Le comportement des personnes** : un élève peut faire une capture d'écran d'une photo
  pendant le vote ; un enseignant voit toutes les photos et les adresses de sa sortie.
  L'application limite et trace, elle ne remplace pas le cadre éducatif.
- **Les journaux du relais e-mail**, qui gardent les adresses des destinataires selon les
  réglages de l'hébergeur.

Le détail est dans le [modèle de menaces](../securite/menaces.md).

## Vos décisions

| Décision | Points d'attention |
|---|---|
| **Autoriser l'usage** | Inscrire le traitement au registre de l'établissement (la [fiche RGPD](../rgpd.md) en fournit la base). |
| **Base légale et autorisations** | À fixer avec votre DPO. Les photos où un élève est reconnaissable relèvent du droit à l'image : recueillez les autorisations des familles comme pour toute captation. |
| **Choisir l'hébergeur** | Vos propres moyens, la collectivité, l'académie ou un prestataire. S'il est extérieur, un **contrat de sous-traitance** (art. 28 RGPD) est nécessaire ; privilégiez un hébergement dans l'Union européenne. |
| **Qui est enseignant** | Toute personne qui peut se connecter au fournisseur d'identité de l'instance (PocketID) peut créer des sorties. Décidez qui y a un compte. |
| **Informer les familles** | Un [modèle de note d'information](../rgpd.md#6-modèle-de-note-dinformation-aux-familles) est fourni. |
| **Quelles adresses e-mail** | Préférez les adresses de l'ENT ou de l'établissement aux adresses personnelles des élèves. |

## Liste de contrôle avant la première sortie

- [ ] Le traitement est inscrit au registre ; le DPO a validé la fiche et, si nécessaire, une
  analyse d'impact (AIPD) — données de mineurs et photos.
- [ ] L'hébergeur a confirmé le [durcissement pour la production](../production-hardening.md)
  (Vault hors mode dev, sauvegardes séparées, antivirus actif, HTTPS).
- [ ] Le contrat de sous-traitance est signé si l'hébergeur est extérieur.
- [ ] Les comptes enseignants sont limités aux personnels concernés.
- [ ] Les familles ont reçu la note d'information et les autorisations de droit à l'image
  sont recueillies.
- [ ] Les enseignants ont lu le [guide de l'enseignant](./enseignant.md), notamment la
  modération et la vérification des noms d'équipe.

## En cas d'incident

Exemples : photo inappropriée diffusée, compte enseignant compromis, e-mails envoyés à de
mauvaises adresses, serveur piraté.

1. **Contenir** : l'enseignant retire la photo ; l'administrateur coupe l'accès concerné ;
   en dernier recours, la sortie peut être **effacée immédiatement** (irréversible).
2. **Prévenir** votre DPO sans attendre.
3. **Notifier** : une violation de données personnelles présentant un risque doit être
   notifiée à la **CNIL dans les 72 heures** (art. 33 RGPD), et aux familles si le risque est
   élevé (art. 34). Votre DPO vous accompagne.
4. **Documenter** : le journal d'audit de l'application trace les actions des enseignants
   (retraits de photos, effacements, renvois de codes…) sans données personnelles.

Pour une **faille dans le logiciel lui-même**, l'administrateur la signale en privé aux
mainteneurs ([politique de sécurité](https://github.com/FB-UNIV/trip-challenges/security/policy)).
