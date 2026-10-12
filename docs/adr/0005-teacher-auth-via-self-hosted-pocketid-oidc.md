# Authentification des enseignants via PocketID auto-hébergé (OIDC)

Les enseignants s'authentifient auprès du fournisseur OIDC **PocketID** auto-hébergé par
l'exploitant ; l'application ne stocke **aucun identifiant local d'enseignant** et
délègue à PocketID l'application de la MFA et des passkeys. Les identifiants
d'administration (les comptes les plus sensibles, capables de configurer les défis et de
déclencher l'effacement) restent ainsi entièrement hors de nos données, et l'on réutilise
une infrastructure que l'exploitant fait déjà tourner.

## Options envisagées

- **Mot de passe + TOTP obligatoire** — rejetée : nous obligerait à stocker et protéger
  les identifiants du rôle le plus sensible.
- **SSO Google Workspace** — sans objet ; l'exploitant n'utilise pas Google et fait
  tourner son propre fournisseur d'identité.
- **Liens magiques par e-mail** — rejetée pour un rôle d'administration : la sécurité se
  réduirait à celle de la boîte mail.

## Conséquences

- La disponibilité de la connexion enseignant dépend de l'accessibilité de PocketID ;
  c'est une dépendance externe sur le chemin d'authentification.
- L'authentification est liée à PocketID/OIDC ; changer de fournisseur d'identité plus
  tard serait une vraie migration (bien que bornée par les standards).
