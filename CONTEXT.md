# Contexte — Trip Challenges

Glossaire de la PWA de défis pour sorties scolaires. Des termes uniquement, pas
d'implémentation. Chaque terme indique entre parenthèses le nom anglais utilisé dans le
code (types, tables, routes) ; l'interface emploie le terme français.

## Langage commun

### Élève (Student)
Participant mineur de la sortie. Identifié par un **code d'accès** personnel envoyé à son
adresse e-mail. Pas un compte complet (pas de mot de passe). Porte une donnée
personnelle : l'e-mail.

### Enseignant (Teacher)
Organisateur. Configure les défis, pilote le cycle de vie de la sortie (période de défis,
période de vote, effacement), modère les photos en lice. Droits étendus. Une sortie a un
enseignant **responsable** (owner, son créateur) qui peut inviter des **co-enseignants**
(co-teachers) ayant les mêmes droits de gestion sur cette sortie.

### Code d'accès (Access Code)
Secret opaque propre à chaque élève, envoyé par e-mail. Mécanisme d'authentification des
élèves. Issu de la liste d'élèves. **À usage unique** : l'utiliser ouvre une session
durable liée à l'appareil ; le code est alors consommé. Un élève qui perd ou change
d'appareil demande un nouveau code à son adresse ; **utiliser ce nouveau code invalide la
session précédente** (la demande seule ne suffit pas — un inconnu qui connaît l'adresse
ne peut donc pas déconnecter l'élève sans lire aussi l'e-mail reçu). Ce n'est pas un mot
de passe permanent et partageable. Valable uniquement jusqu'à l'effacement de la sortie.
Le code est saisi à la main, il est donc haché avec argon2 (KDF lente). Le jeton de
session qu'il produit est un aléa de 256 bits vérifié à chaque requête : il est stocké
sous forme de hachage SHA-256, une KDF lente n'apportant rien pour un secret impossible à
deviner (#64).
_À éviter_ : mot de passe, identifiant, code PIN (ce n'est pas un secret choisi).

### Inscrit (Joined)
Un élève est **inscrit** dès qu'il a utilisé un code d'accès sur un appareil au moins une
fois. Demander plus tard un nouveau code (appareil perdu) ne l'annule pas. Un élève qui a
reçu un code sans jamais en utiliser est **invité** (invited), pas inscrit. Une adresse de
la liste dont l'e-mail n'a pas pu être distribué ne devient jamais un élève
(**non distribué**, undelivered).
_À éviter_ : enregistré, actif (un élève inscrit peut ne pas avoir rouvert l'application depuis).

### Liste d'élèves (Roster)
Liste d'adresses e-mail d'élèves importée en masse par un enseignant. L'établissement
détient le consentement parental hors ligne et est **responsable de traitement** ; ce
système est **sous-traitant**. Les adresses de la liste sont détruites à l'effacement.

### Équipe (Team)
Regroupement volontaire d'élèves, formé par les élèves eux-mêmes. C'est l'équipe qui est
créditée des photos. Les équipes sont **facultatives** pour l'élève : celui qui joue seul
forme une équipe d'une personne (#79). Règles :
- **Exclusive** : un élève appartient à une seule équipe à la fois.
- **Solo autorisé** : une équipe peut n'avoir qu'un membre. Un élève sans équipe peut
  **jouer en solo** pendant la période de défis en créant une équipe d'une personne
  (nommée comme toute équipe). Personne ne peut la rejoindre, l'adhésion étant alors
  verrouillée.
- **Figée** : rejoindre et quitter une équipe se verrouillent au début de la période de
  défis. Créer une équipe reste possible jusqu'au vote, pour qu'un élève sans équipe
  puisse encore jouer en solo.
- **Bornée** : de 1 à maxTeamSize membres, maxTeamSize étant fixé par sortie par
  l'enseignant (4 par défaut).
- **Nommée par les élèves, vérifiée par un enseignant** : le nom d'une équipe est un
  texte libre qui peut identifier des élèves. Un enseignant peut renommer une équipe à
  tout moment avant la révélation et marque son nom comme **vérifié** (reviewed ;
  renommer vaut vérification). Les noms non vérifiés s'affichent pendant la sortie et la
  cérémonie, mais ne survivent jamais à l'effacement.

### Sortie (Trip)
Le conteneur de plus haut niveau pour une sortie scolaire, et la frontière d'isolation.
Elle possède la liste d'élèves, les défis, la configuration (par ex. maxTeamSize, barème
des points) et les phases du cycle de vie (période de défis → période de vote →
effacement). Tout est cloisonné par `tripId`. Créée et possédée par un enseignant ; un
enseignant ne voit que ses propres sorties. Un même déploiement héberge **de nombreuses
sorties, éventuellement simultanées** ; chaque sortie a sa propre clé de chiffrement
(rayon d'impact limité à la sortie). Une même adresse d'élève peut figurer dans les listes
de deux sorties : ce sont alors **deux élèves distincts** avec des codes d'accès
distincts ; aucune donnée ne passe d'une sortie à l'autre.

### Défi (Challenge)
Une tâche configurée par un enseignant, accomplie en envoyant une photo. Attributs :
titre, consignes, un QR code associé, et un **multiplicateur** (1 par défaut ; par ex. 2
pour un défi « boss ») qui pondère ses points pour le grand champion. Rattaché à une
sortie.
_À éviter_ : tâche, quête, mission.

### QR code (QR Code)
Code imprimé et statique associé à un défi (il encode l'URL du défi ; imprimable une
fois). Le scanner ouvre la page du défi. L'envoi exige une session élève authentifiée
(via le code d'accès) ; la photo est attribuée à l'équipe de l'élève. Scanner seul ne
donne aucun accès.

### Photo (Submission)
Une photo envoyée par n'importe quel membre d'une équipe pour un défi. Une équipe peut
avoir plusieurs photos par défi. Soumise à l'effacement. Tout membre de l'équipe peut en
envoyer. Source : prise de vue directe OU galerie de l'appareil.

Pendant la période de défis, une photo n'est visible que par sa propre équipe ; les
photos non sélectionnées restent réservées à l'équipe pour toujours (jamais publiques).
Une photo ne devient publique que si elle est sélectionnée **et** validée par la
modération, au moment du vote. **Les enseignants de la sortie peuvent voir et retirer
N'IMPORTE QUELLE photo à tout moment** (pas seulement celles en lice) — les envois
inappropriés jamais sélectionnés restent donc rattrapables.

### Modération (Moderation)
Deux niveaux. (1) **Modération des photos en lice** : un enseignant examine les photos
sélectionnées avant l'ouverture du vote ; seules les photos **validées** deviennent
votables/publiques (états `pending → approved | rejected`, soit en attente → validée |
refusée) ; une photo refusée n'est pas montrée et l'équipe peut en sélectionner une autre
tant que la période de défis est ouverte. (2) **Surveillance permanente** : un enseignant
peut voir et retirer **n'importe quelle** photo de sa sortie à tout moment,
indépendamment de la sélection — le filet de sécurité pour les contenus qui n'entrent
jamais dans le circuit de sélection.

### Photo en lice / sélection (Nomination)
L'unique photo qu'une équipe sélectionne (par défi) pour participer au vote. Seules les
photos en lice sont votables. Si une équipe n'a rien sélectionné à l'ouverture du vote,
sa **dernière** photo est sélectionnée automatiquement. Les photos non sélectionnées
sont **conservées jusqu'à l'effacement final** (ce qui permet de changer de sélection
tant que la période de défis est ouverte). Un enseignant modère chaque photo en lice :
**en attente**, puis **validée** ou **refusée**. L'équipe voit cet état sur ses photos et
sa liste de défis (#81). Un refus est **définitif** : l'équipe peut choisir une autre
photo tant que la période de défis est ouverte, mais elle n'est **pas** resélectionnée
automatiquement à l'ouverture du vote. Un enseignant peut encore refuser après
l'ouverture du vote, après un avertissement indiquant que l'équipe ne pourra plus
remplacer sa photo.

### Période de vote (Voting Period)
La phase qui suit la période de défis. Les élèves authentifiés votent pour élire un
gagnant par défi. Le mécanisme est le **vote par paire (duels façon Tinder)** : on montre
au votant deux photos validées du même défi et il choisit la meilleure ; et ainsi de
suite. Contraintes : pas de vote pour soi (on ne montre jamais au votant une paire
contenant la photo de sa propre équipe), résultats cachés jusqu'à la clôture.

### Duel (Duel)
Une comparaison par paire : deux photos en lice du même défi montrées à un votant, qui en
choisit une. Cela produit une victoire pour la photo choisie et une défaite pour l'autre.
C'est l'unité de base du vote (il n'y a pas « un vote par votant »). Appariement : **la
moins comparée d'abord** (la photo qui a le moins de comparaisons) contre une adversaire
éligible tirée au hasard, en excluant l'équipe du votant ; une même paire n'est pas
reproposée au même votant. Les votants peuvent faire des duels **sans limite** par défi ;
le système les oriente vers les paires les moins comparées. Comme on ne montre jamais au
votant la photo de sa propre équipe, un défi a besoin d'**au moins 3 équipes** avec des
photos validées pour qu'un duel soit possible — avec 2 équipes, chaque votant est l'un
des deux participants, aucune paire valide n'existe et le vote ne peut pas avoir lieu.

### Classement (Ranking)
Pour chaque défi, chaque photo en lice accumule un bilan de victoires/défaites issu des
duels. Score = **borne inférieure de Wilson** du taux de victoire (victoires /
comparaisons), ce qui traite équitablement des nombres de comparaisons inégaux ou faibles.

### Gagnant (Winner)
La photo en lice (et son équipe) qui a le meilleur score de classement pour un défi. Des
scores égaux **partagent la place et ses points** (classement sportif standard : deux
premiers → le suivant est troisième) ; les égalités par défi ne sont **pas** départagées
à la main par l'enseignant. Une seule première place par défi (éventuellement partagée).

### Grand champion (Grand Champion)
Le gagnant global de la sortie. Chaque défi produit un ordre de placement (issu du
classement). L'enseignant configure un **barème des points** par sortie — par défaut les
**3 premiers** (1er = 5, 2e = 3, 3e = 1), 0 pour les autres ; profondeur et valeurs
modifiables. Pour chaque défi, les points de placement sont multipliés par le
**multiplicateur** du défi, puis additionnés sur tous les défis pour chaque équipe ; le
plus haut total est grand champion. Une égalité pour le titre de grand champion est
départagée par une action explicite de l'**enseignant** pendant la cérémonie (toutes les
équipes à égalité apparaissent comme co-champions jusqu'à ce que l'enseignant en choisisse
une) — c'est la **seule** égalité que l'enseignant départage à la main. Les résultats
sont calculés à la clôture du vote mais dévoilés lors d'une **cérémonie rythmée par
l'enseignant** : une **révélation partagée** unique (un écran — un vidéoprojecteur, une
salle), qui avance défi par défi au rythme de l'enseignant. Elle n'est **pas**
synchronisée sur l'appareil de chaque élève. Les résultats **ne sont pas visibles
publiquement** tant que l'enseignant n'a pas terminé la cérémonie ; ce n'est qu'ensuite
que la page complète des résultats se débloque (et reste un souvenir public jusqu'à
l'effacement).

### Cycle de vie (Lifecycle)
Une sortie passe de la période de défis à la période de vote, puis à l'effacement.
Phases dans le code : `draft` (brouillon) → `challenge` (défis) → `voting` (vote) →
`reveal` (révélation) → `grace` (délai de grâce) → `erased` (effacée). L'enseignant fixe
des dates prévues (ouverture des défis, ouverture du vote, clôture du vote) ; la sortie
passe automatiquement en période de défis puis en période de vote à ces dates, ou plus tôt
si l'enseignant avance à la main. À la date de clôture, le vote s'arrête, mais la
cérémonie de révélation démarre toujours par un clic de l'enseignant. L'effacement se
déclenche automatiquement après le délai de grâce ; un enseignant peut le déclencher plus
tôt.

### Effacement (Erasure)
Destruction irréversible de toutes les données personnelles des élèves et de toutes les
photos d'une sortie. Exigence centrale (données de mineurs).

**Déclenchement** : clôture du vote → gagnants dévoilés → un délai de grâce configuré par
l'enseignant s'écoule (par ex. 7 jours par défaut) → effacement automatique. Un
enseignant peut le déclencher plus tôt. **Date butoir de secours** : une sortie est
effacée d'office à `tripEndDate + maxRetention` (30 jours par défaut) **quelle que soit
la phase** — même en pleine période de défis ou de vote — pour que des données
oubliées ne puissent pas traîner. Les enseignants sont prévenus avant.

**Périmètre** — détruit :
- Tous les fichiers photo (stockage objet) — **y compris les photos des gagnants** (le
  visage d'un mineur est une donnée personnelle, même sans nom).
- Toutes les lignes de base concernant élèves/équipes/votes/duels et les adresses de la
  liste d'élèves.
- **Sauvegardes et instantanés** — par effacement cryptographique : chaque sortie est
  chiffrée sous une clé propre ; l'effacement détruit la clé, ce qui rend toute sauvegarde
  résiduelle illisible (plutôt que de courir après chaque instantané).
- **Journaux et traces de distribution des e-mails** — nettoyés/renouvelés pour qu'aucune
  donnée personnelle d'élève ne subsiste.

**Subsiste** (uniquement le non personnel) :
- Un enregistrement de résultat du type « l'équipe RENARD a gagné le défi 3 » — titre du
  défi + nom de l'équipe gagnante, **sans image ni identité d'élève**. Seul un nom
  d'équipe **vérifié** subsiste ; un nom non vérifié est remplacé à l'effacement par une
  étiquette neutre (« Équipe 3 »).
- Le **journal d'audit des actions des enseignants** (par ex. « un enseignant a retiré une
  photo à T », « effacement déclenché ») — **sans données personnelles par conception**
  (il référence des identifiants opaques et l'identité de l'enseignant, jamais des
  données d'élèves), et c'est précisément pour cela qu'il peut subsister.

## Questions ouvertes

Le modèle du domaine est stabilisé. Les questions d'origine sont tranchées :
- Invitation des co-enseignants : un lien personnel envoyé par e-mail, valable 7 jours.
- Alerte avant effacement : des e-mails progressifs aux enseignants de la sortie.
- Pondération des défis : chaque défi porte un multiplicateur (1 par défaut).
- Limitation des abus : limites de débit par IP et par élève connecté, sur toutes les
  routes dont les duels et l'utilisation des codes d'accès.
