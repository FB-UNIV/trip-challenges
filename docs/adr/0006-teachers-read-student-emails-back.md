# Les enseignants peuvent relire les e-mails des élèves de leur sortie

Jusqu'ici, aucune route côté enseignant ne déchiffrait l'e-mail d'un élève : la liste
entrait, et seuls des décomptes ressortaient. En préproduction, les enseignants voyaient
« 4 ne sont pas inscrits, 1 e-mail en échec » mais pas *qui*, et ne pouvaient donc ni
relancer un retardataire ni corriger une adresse mal saisie. Nous déchiffrons désormais,
pour les seuls enseignants d'une sortie, l'e-mail de chaque élève dans la liste des élèves
de l'enseignant (avec son statut inscrit / invité / non distribué et son équipe), et
permettons de renvoyer un code ou de corriger une adresse non distribuée.

L'établissement est responsable de traitement (ADR-0004) et l'enseignant agit pour son
compte ; il a saisi ces adresses lui-même, les relire n'élargit donc la connaissance de
personne. L'e-mail reste la seule donnée personnelle d'élève que nous détenons, sous la
clé de la sortie (ADR-0001), et il est détruit à l'effacement comme avant.

## Options envisagées

- **Décomptes seulement, pas de liste par élève** — aucun nouveau chemin de déchiffrement,
  mais l'enseignant ne peut rien faire de « 4 ne sont pas inscrits » ; rejetée car elle
  laisse le vrai travail inachevé.
- **E-mails masqués** (`l•••@ecole.fr`) — semble plus sûr mais ne l'est pas : quiconque
  connaît la classe peut les deviner, et une faute de frappe devient impossible à repérer.

## Conséquences

- Un nouveau chemin de déchiffrement de données de mineurs, protégé comme toute route
  enseignant (appartenance à la sortie ; 404 pour les autres).
- Garde-fous : la journalisation des requêtes masque les e-mails et ne journalise jamais
  les corps — un test fait passer ces routes, y compris les envois en échec dont les
  erreurs répètent l'adresse, par le journaliseur de production. La réponse à un envoi en
  échec est générique.
- Le journal d'audit n'enregistre que des **actions** (`access_code_resent`,
  `roster_address_fixed`, `roster_item_retried`), avec des identifiants opaques ; consulter
  la liste n'est pas audité — les enseignants ont déjà droit à ces adresses, et le journal
  d'audit sert à prouver ce qui a été modifié ou détruit. À revoir si le DPO d'un
  établissement exige une journalisation des accès.
- Les informations par élève restent volontairement minces : statut et équipe seulement
  — pas de « vu pour la dernière fois », ni de photos ou de votes par élève (pas de
  surveillance individuelle des enfants).
