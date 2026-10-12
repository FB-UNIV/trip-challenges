# Guide de l'enseignant

Vous organisez une sortie : vous créez les défis, invitez les élèves, modérez les photos et
animez la cérémonie des résultats. Ce guide suit une sortie du début à la fin.

::: tip En résumé
1. Créez la sortie et ses défis, imprimez les QR codes.
2. Importez les adresses e-mail des élèves : chacun reçoit son lien personnel.
3. Les élèves forment leurs équipes, puis vous **lancez les défis**.
4. Vous **modérez** les photos mises en lice, puis vous **ouvrez le vote**.
5. Vous **fermez le vote**, projetez la **cérémonie**, puis **publiez les résultats**.
6. Tout est **effacé** automatiquement après le délai de grâce.
:::

## Se connecter

Ouvrez l'adresse de votre instance, puis **Je suis enseignant** (ou directement `/teacher`).
La connexion passe par le compte de votre établissement (PocketID) : l'application ne
stocke aucun mot de passe. Votre session dure **8 heures** ; sur un poste partagé, fermez
le navigateur en partant.

## Créer la sortie

**Nouvelle sortie** demande :

- **Nom** — visible des élèves (par ex. « Rome 2030 »).
- **Date de fin de la sortie** — elle fixe la **date butoir d'effacement** : fin de sortie +
  30 jours par défaut, quoi qu'il arrive.
- **Taille max. d'une équipe** — 4 par défaut ; modifiable seulement tant que la sortie est
  en brouillon.

La page de la sortie s'organise en sections : **Vue d'ensemble**, **Défis**, **Élèves**,
**Modération**, **Résultats** (à partir de la révélation) et **Paramètres**. La carte
**Maintenant** de la vue d'ensemble indique toujours ce qui est prêt, ce qui manque, et le
bouton qui fait passer à l'étape suivante.

## Préparer les défis

Dans **Défis**, ajoutez pour chaque défi :

- un **titre** et des **consignes** ;
- un **multiplicateur de points** (×2 pour un défi « boss »).

**Imprimer les QR codes** ouvre une feuille avec une carte par défi, à découper et placer
sur le parcours. Scanner un QR ouvre la page du défi ; il faut un code d'accès pour y
envoyer une photo.

::: warning Le titre et les consignes d'un défi sont lisibles par quiconque scanne son QR code
N'y mettez aucune information personnelle (nom d'élève, lieu d'hébergement, horaires…).
:::

| Action | Possible jusqu'à… |
|---|---|
| Ajouter un défi | l'ouverture du vote |
| Modifier titre, consignes, multiplicateur | le calcul des résultats |
| Supprimer un défi | la fin du brouillon (le QR est peut-être déjà imprimé) |

## Inviter les élèves

Dans **Élèves**, collez les adresses e-mail (une par ligne, ou séparées par des virgules) puis
**Importer et envoyer les codes**. Chaque élève reçoit un e-mail « Ton code d'accès pour… »
avec un **lien personnel à usage unique** : l'ouvrir sur son téléphone le connecte sur cet
appareil.

La liste des élèves montre pour chacun son statut :

| Statut | Signification | Que faire |
|---|---|---|
| **Inscrit** | A ouvert son lien au moins une fois | Rien |
| **Invité** | A reçu un code, ne l'a pas encore utilisé | **Renvoyer le code** si besoin |
| **Non distribué** | L'e-mail n'a pas pu être livré | **Corriger l'adresse** (le code part à la nouvelle) |
| **Envoi** | Envoi en cours | Patienter |

Les filtres (Pas inscrits, Non distribués, Sans équipe) et la recherche par e-mail aident à
relancer les retardataires.

**Un élève a perdu ou changé de téléphone ?** Copiez le **lien de récupération de code** (en
bas de la page Élèves) et donnez-le-lui : il saisit son adresse et reçoit un nouveau lien.
Son ancien téléphone est déconnecté dès qu'il utilise le nouveau.

::: info Pourquoi vous voyez les adresses
L'établissement est responsable de ces données et vous les avez saisies vous-même ;
les relire vous permet de corriger une faute de frappe
([ADR 0006](../adr/0006-teachers-read-student-emails-back.md)). Vous ne voyez rien de plus
sur un élève que son statut et son équipe — ni ses photos à lui, ni ses votes.
:::

## Équipes

Les élèves forment eux-mêmes leurs équipes pendant le brouillon. Un élève peut **jouer en
solo** : il crée une équipe d'une personne, même une fois les défis lancés.

Les **noms d'équipe** sont libres et peuvent identifier des élèves (« Léa & Tom 4B »). Dans
**Élèves → Équipes**, cliquez **Nom OK** ou **Renommer** pour chaque équipe avant la
révélation : **seuls les noms vérifiés survivent à l'effacement**, les autres deviennent
« Équipe 1 », « Équipe 2 »… ([ADR 0007](../adr/0007-team-names-survive-erasure-only-if-reviewed.md)).

## Planifier (facultatif)

Dans **Paramètres → Dates prévues**, fixez l'ouverture des défis, l'ouverture du vote et la
clôture du vote : la sortie avance toute seule à ces dates. Sans dates, c'est vous qui
avancez avec la carte **Maintenant**. La cérémonie, elle, démarre toujours par votre clic.

Les **Paramètres** contiennent aussi le **barème des points** (par défaut 5, 3 et 1 point
pour les trois premières places de chaque défi), le **délai de grâce** (7 jours) et la
**conservation max.** (30 jours après la fin de la sortie).

## Pendant les défis

**Lancer les défis** verrouille les équipes : on ne peut plus en rejoindre ni en quitter.
Les élèves scannent les QR codes, envoient des photos (chacune est analysée par l'antivirus
et débarrassée de ses métadonnées, dont la position GPS) et **sélectionnent** une photo par
défi.

### Modérer

Chaque photo sélectionnée arrive dans **Modération** :

- **Valider** — elle participera au vote ;
- **Refuser** — l'équipe voit le refus et peut en choisir une autre tant que les défis sont
  ouverts ;
- **Retirer la photo…** — à tout moment, pour **n'importe quelle** photo de la sortie (même
  jamais sélectionnée) : plus personne ne la verra. À utiliser pour tout contenu inapproprié.

Seules les photos **validées** sont montrées aux autres élèves pendant le vote.

## Le vote

**Ouvrir le vote** ferme l'envoi de photos. Une équipe qui n'a rien sélectionné voit sa
dernière photo sélectionnée automatiquement (elle reste à modérer).

Chaque élève vote par **duels** : deux photos d'un même défi, il choisit la meilleure,
jamais celle de son équipe. Il faut donc **au moins 3 équipes avec une photo validée** pour
qu'un défi soit votable — la carte Maintenant le signale. Vous voyez combien d'élèves ont
voté, **jamais pour qui**.

## La cérémonie

**Fermer le vote et calculer les résultats** passe en révélation. Les élèves ne voient pas
encore les résultats.

Dans **Résultats**, **Lancer la cérémonie** ouvre un plein écran pour le vidéoprojecteur :
clic, Espace ou → pour dévoiler le podium de chaque défi, ← pour revenir, jusqu'au **grand
champion**. En cas d'égalité pour le titre, choisissez le gagnant avec **Couronner cette
équipe**.

Ensuite, **Publier les résultats** (carte Maintenant) les rend visibles aux élèves et ouvre
le délai de grâce.

## L'effacement

À la fin du délai de grâce — ou au plus tard à la date butoir — **tout est effacé
automatiquement** : adresses, photos (y compris celles des gagnants), équipes, votes. Les
enseignants reçoivent des alertes par e-mail avant. Il ne reste que les résultats (défi,
place, points, nom d'équipe vérifié ou « Équipe N »).

Pour effacer plus tôt : **Paramètres → Zone de danger → Effacer toutes les données des
élèves**, en tapant le nom de la sortie. C'est **irréversible**.

## Travailler à plusieurs

Le **responsable** de la sortie (son créateur) peut **inviter des co-enseignants** dans
Paramètres → Enseignants : l'invité reçoit un lien valable 7 jours, à ouvrir en se
connectant avec **l'adresse invitée**. Un co-enseignant a les mêmes droits de gestion — y
compris l'effacement — sauf inviter d'autres enseignants.

## Vos responsabilités

- Ne mettez **aucune donnée personnelle** dans les noms de sortie, titres et consignes.
- **Vérifiez les noms d'équipe** avant la révélation.
- **Modérez** : vous êtes le filet de sécurité pour les contenus inappropriés.
- Ne transférez pas les liens des élèves ; donnez le lien de récupération à l'élève concerné
  uniquement.
- Signalez tout incident (photo problématique, compte compromis, envoi à une mauvaise
  adresse) à votre direction et à l'administrateur.

## Questions fréquentes

**Un élève n'a pas reçu son e-mail.** Vérifiez ses spams, puis son statut : *Non distribué* →
corrigez l'adresse ; *Invité* → renvoyez le code.

**« Ce lien n'est pas valide ou a déjà été utilisé ».** Le lien est à usage unique et a déjà
servi (souvent sur un autre appareil). Donnez le lien de récupération.

**Un défi n'apparaît pas dans le vote.** Il lui faut au moins 3 équipes avec une photo
validée.

**Je ne peux plus modifier la taille des équipes.** Elle est figée dès le lancement des défis.
