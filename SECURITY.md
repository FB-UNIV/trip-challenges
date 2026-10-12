# Politique de sécurité

Trip Challenges stocke **des photos et des données personnelles de mineurs**. Les
signalements de sécurité sont pris au sérieux et traités en priorité.

## Signaler une vulnérabilité

**N'ouvrez pas de ticket public.** Signalez-la en privé via GitHub :
[**Report a vulnerability**](https://github.com/FB-UNIV/trip-challenges/security/advisories/new)
(onglet Security → *Report a vulnerability*).

Indiquez ce qu'un attaquant peut atteindre (quel rôle, quelle phase), les étapes pour
reproduire, et la version ou le commit testé. Vous devriez recevoir une première réponse
sous une semaine. Les signalements en français ou en anglais sont les bienvenus.

## Versions prises en charge

Seule la dernière version reçoit des correctifs. Les exploitants doivent suivre les
releases et mettre à jour avec `docker compose up -d` (les migrations s'appliquent au
démarrage).

## Particulièrement concernés

- Tout ce qui permet de lire ou de conserver des données d'élèves après l'**effacement**
  d'une sortie (effacement cryptographique —
  [ADR 0001](./docs/adr/0001-crypto-erasure-with-vault-per-trip-keys.md))
- L'accès à une autre sortie, ou un élève qui agit comme un enseignant ou comme un autre
  élève
- Des données personnelles d'élèves écrites dans les journaux ou stockées hors du
  périmètre chiffré de la sortie
- Le traitement des envois (contournement de l'antivirus, confusion de type de contenu,
  fichiers trop volumineux)

Hors périmètre : les problèmes qui supposent un serveur d'exploitation déjà compromis, et
le déni de service par volume contre une instance auto-hébergée.
