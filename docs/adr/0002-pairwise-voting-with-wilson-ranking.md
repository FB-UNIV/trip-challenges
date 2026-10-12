# Vote par paire (façon Tinder) classé par la borne inférieure de Wilson du taux de victoire

Les gagnants sont élus en montrant à chaque votant deux photos en lice du même défi et en
lui faisant choisir la meilleure (un duel), de façon répétée — et non par un décompte
d'un vote par votant. Chaque photo en lice accumule un bilan de victoires/défaites ; son
score est la **borne inférieure de Wilson de son taux de victoire** (victoires /
comparaisons), de sorte que des photos ayant des nombres de comparaisons inégaux ou
faibles sont classées équitablement, plutôt que selon leur popularité brute ou l'ordre
d'exposition.

## Options envisagées

- **Un vote par votant, gagnant = le plus de voix** — rejetée : l'expérience demandée
  repose sur le glissement/les duels, et les décomptes bruts sont biaisés par le nombre de
  fois où chaque photo se trouve montrée.
- **Classement ELO / Bradley-Terry** — adapté naturellement aux duels par paire, mais
  sensible à l'ordre des comparaisons et au choix des notes initiales, et plus difficile à
  expliquer aux enseignants et aux élèves qu'un taux de victoire avec une borne de
  confiance.
- **Taux de « j'aime » brut (Wilson sur j'aime/vues)** — la variante à glissement
  binaire ; remplacée dès que le mécanisme est devenu un vote par paire, « vues/j'aime »
  devenant « comparaisons/victoires ».

## Conséquences

- L'appariement suit **la moins comparée d'abord + une adversaire éligible tirée au
  hasard**, en excluant l'équipe du votant et sans jamais reproposer une paire au même
  votant ; les votants font autant de duels qu'ils veulent par défi, guidés vers la
  couverture. Cela égalise les nombres de comparaisons pour que les intervalles de Wilson
  se resserrent le plus vite possible.
- L'équité dépend d'un nombre suffisant de duels par photo ; un vote clairsemé donne des
  intervalles de confiance larges et des scores bas pour tout le monde.
