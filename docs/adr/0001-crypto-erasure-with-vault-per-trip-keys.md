# Effacement cryptographique par des clés de sortie dans un Vault auto-hébergé

Ce système contient des photos et des données personnelles de mineurs qui doivent être
détruites *complètement et de façon vérifiable* à la fin de la sortie — y compris toute
copie résiduelle dans les sauvegardes de la base et du stockage objet. Nous chiffrons donc
au repos les données de chaque sortie (fichiers photo + colonnes de données personnelles)
sous une clé propre à la sortie, détenue par un HashiCorp Vault auto-hébergé (moteur
transit). Les sauvegardes de la base et de MinIO ne contiennent ainsi **que du chiffré,
aucun matériel de clé**. L'effacement consiste à supprimer la clé de la sortie dans Vault,
ce qui rend toute copie résiduelle définitivement illisible.

## Options envisagées

- **Clé de sortie stockée dans une colonne de la base (enveloppée par une KEK globale)** —
  rejetée : les sauvegardes nocturnes de la base capturent la clé enveloppée, donc détruire
  la clé en production ne neutralise pas les sauvegardes (une sauvegarde restaurée + la KEK
  toujours présente permettent de la reconstituer). Échoue sur l'exigence « complètement
  effacé ».
- **KEK gérée par l'application dans un coffre de secrets (chiffrement par enveloppe fait
  maison)** — viable si la clé destructible ne vit que dans le coffre, mais fait reposer
  la correction, auditée, du cycle de vie des clés sur notre propre code.
- **KMS cloud** — garantie équivalente, mais réintroduit la dépendance au cloud que
  l'auto-hébergement évite, et confie le matériel de clé des mineurs à un tiers.

## Conséquences

- Vault devient une dépendance forte et un point de défaillance unique pour les lectures
  pendant une sortie ; il doit être disponible (secours à chaud) et son propre stockage
  doit rester hors des sauvegardes de la base.
- « Effacé » est défini comme *clé détruite* ; il n'y a pas de retour arrière. Les données
  d'une sortie sont irrécupérables dès que sa clé est supprimée — conforme à l'exigence,
  mais impitoyable à l'exploitation.
