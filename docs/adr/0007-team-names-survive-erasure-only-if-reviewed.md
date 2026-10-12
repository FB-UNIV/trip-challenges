# Les noms d'équipe ne survivent à l'effacement que s'ils ont été vérifiés par un enseignant

Les résultats (titre du défi, place, nom d'équipe, points) sont le seul enregistrement de
la sortie conservé après l'effacement, non chiffré, comme souvenir public. Les noms
d'équipe sont du texte libre choisi par les élèves et peuvent les identifier
(« Léa & Tom 4B ») ; l'ADR-0004 exigeait donc qu'ils soient vérifiés avant d'être
conservés — mais rien ne l'imposait : le nom brut était copié dans les résultats à la
révélation (#92). Nous enregistrons désormais à la révélation si le nom de chaque équipe a
été **vérifié** par un enseignant (en le marquant, ou en le renommant), ainsi qu'une
étiquette neutre (« Équipe N », dans l'ordre de création des équipes). À l'effacement,
avant la destruction de la clé de la sortie, chaque nom non vérifié dans les résultats est
remplacé par son étiquette. Les noms vérifiés survivent tels quels.

La révélation n'est volontairement **pas** bloquée par la vérification : la cérémonie
projetée montre les vrais noms que la salle connaît, et un nom non vérifié est neutralisé
plus tard, plutôt qu'une vérification oubliée ne bloque la soirée.

## Options envisagées

- **Bloquer la révélation tant que tous les noms ne sont pas vérifiés** — la garantie la
  plus forte, mais une vérification oubliée arrête la cérémonie devant la classe ; rejetée
  par le responsable produit.
- **Simple rappel, sans suivi** — repose sur la mémoire de l'enseignant ; un oubli laisse
  un texte identifiant après l'effacement. Échoue sur la garantie d'effacement.
- **Toujours remplacer les noms par des étiquettes à l'effacement** — le plus simple et le
  plus sûr, mais perd la valeur de souvenir des noms explicitement approuvés par
  l'enseignant.
- **Accepter de conserver les noms libres** (en amendant l'ADR-0004) — rejetée :
  l'établissement est responsable de traitement, et rien de ce qu'un élève tape ne doit
  survivre à la sortie sans vérification.

## Conséquences

- Le comportement par défaut est sûr : une sortie dont l'enseignant ne vérifie rien ne
  conserve que « Équipe 1…N » après l'effacement (« Team 1…N » pour les résultats
  calculés avant le passage de l'application au français).
- Les résultats calculés avant ce changement ne portent pas d'étiquette ; l'effacement les
  numérote alors par nom. Les sorties déjà effacées au moment de cette livraison ont vu
  leurs noms conservés neutralisés par la migration `0003` (impossible de savoir lesquels
  avaient été vérifiés).
- Les enseignants ont besoin d'un moyen de vérifier et de renommer les noms d'équipe avant
  la révélation (#94, #95, livré) ; sans vérification, un nom est neutralisé à
  l'effacement.
