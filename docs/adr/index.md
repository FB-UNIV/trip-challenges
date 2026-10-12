# Décisions d'architecture (ADR)

Chaque ADR consigne une décision structurante : le contexte, les options écartées et leurs
conséquences. Une décision qui change donne lieu à un nouvel ADR (ou à une mise à jour
explicite), jamais à une réécriture silencieuse.

| N° | Décision |
|---|---|
| [0001](./0001-crypto-erasure-with-vault-per-trip-keys.md) | Effacement cryptographique par des clés de sortie dans un Vault auto-hébergé |
| [0002](./0002-pairwise-voting-with-wilson-ranking.md) | Vote par paire classé par la borne inférieure de Wilson |
| [0003](./0003-self-hosted-docker-compose-over-managed-ha.md) | docker-compose auto-hébergé plutôt que cloud managé ou k8s |
| [0004](./0004-roster-import-school-as-controller.md) | Import de la liste d'élèves, l'établissement étant responsable de traitement |
| [0005](./0005-teacher-auth-via-self-hosted-pocketid-oidc.md) | Authentification des enseignants via PocketID (OIDC) |
| [0006](./0006-teachers-read-student-emails-back.md) | Les enseignants peuvent relire les e-mails des élèves de leur sortie |
| [0007](./0007-team-names-survive-erasure-only-if-reviewed.md) | Les noms d'équipe ne survivent à l'effacement que s'ils ont été vérifiés |
