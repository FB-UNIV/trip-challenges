---
layout: home

hero:
  name: Trip Challenges
  text: Des défis photo pour les sorties scolaires
  tagline: Les élèves relèvent des défis, votent pour les meilleures photos, et tout est effacé à la fin de la sortie — de façon vérifiable.
  actions:
    - theme: brand
      text: Je suis enseignant
      link: /roles/enseignant
    - theme: alt
      text: Sécurité des données
      link: /securite/menaces
    - theme: alt
      text: Code source
      link: https://github.com/FB-UNIV/trip-challenges

features:
  - icon: 📸
    title: Des défis sur le terrain
    details: Chaque défi a son QR code imprimé. Les équipes le scannent, prennent leurs photos et choisissent leur meilleure.
  - icon: ⚖️
    title: Un vote par duels
    details: Les élèves comparent les photos deux à deux, jamais celle de leur équipe. Un classement statistique départage équitablement.
  - icon: 🏆
    title: Une cérémonie en classe
    details: L'enseignant dévoile les gagnants défi par défi sur le vidéoprojecteur, jusqu'au grand champion.
  - icon: 🔐
    title: Effacement vérifiable
    details: Chaque sortie est chiffrée sous sa propre clé. À la fin, la clé est détruite — même les sauvegardes deviennent illisibles.
---

## Qui êtes-vous ? {#qui-etes-vous}

Chaque rôle a son guide : ce qu'il fait dans l'application, ce dont il est responsable, et
ce qu'il doit savoir sur les données des élèves.

| Vous êtes… | Votre guide | En bref |
|---|---|---|
| 🧑‍🏫 **Enseignant** | [Organiser une sortie](./roles/enseignant.md) | Créer la sortie et les défis, inviter les élèves, modérer, animer la cérémonie. |
| 🎒 **Élève, ou parent d'élève** | [Participer](./roles/eleve.md) | Rejoindre la sortie, former une équipe, envoyer des photos, voter. Et ce que deviennent tes données. |
| 🏫 **Chef d'établissement** | [Décider et encadrer](./roles/direction.md) | Responsable de traitement : autoriser l'usage, informer les familles, choisir l'hébergeur. |
| 🛡️ **DPO, référent RGPD ou sécurité** | [Contrôler la conformité](./roles/dpo.md) | Fiche de traitement, mesures techniques, preuves d'effacement, gestion d'incident. |
| 🖥️ **Administrateur (exploitant)** | [Héberger et maintenir](./roles/administrateur.md) | Installer, durcir, sauvegarder, surveiller et mettre à jour l'instance. |

Et pour tous : le [modèle de menaces](./securite/menaces.md) détaille ce qui pourrait mal
tourner — vecteurs d'attaque, compromissions possibles — et ce qui est en place pour s'en
protéger.

## Le principe en une image

```mermaid
flowchart LR
  B["Brouillon<br/>équipes formées"] --> D["Défis<br/>photos et sélection"]
  D --> V["Vote<br/>duels par paire"]
  V --> R["Révélation<br/>cérémonie"]
  R --> G["Délai de grâce<br/>résultats visibles"]
  G --> X["Effacée<br/>clé de la sortie détruite"]
```

Trip Challenges est un logiciel libre (AGPL-3.0), **auto-hébergé** : l'établissement ou son
prestataire l'installe sur ses propres serveurs. Les auteurs du logiciel n'ont accès à
aucune donnée.
