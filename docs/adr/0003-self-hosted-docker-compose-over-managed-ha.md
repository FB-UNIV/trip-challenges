# docker-compose auto-hébergé avec secours à chaud, plutôt que cloud managé ou k8s

Nous déployons l'ensemble du système (PWA React, réplicas de l'API TypeScript, Postgres,
MinIO, Vault) comme une pile docker-compose auto-hébergée, avec une base de secours à
chaud et des sauvegardes que nous maîtrisons, plutôt que des services cloud managés
(RDS/S3) ou un orchestrateur multi-nœuds (k8s/Swarm). La contrainte décisive est
l'*effacement complet des données de mineurs* : les services managés répliquent données et
sauvegardes dans des régions que nous ne pouvons ni attester ni purger complètement,
alors que l'auto-hébergement garde chaque copie dans une infrastructure que nous
contrôlons. L'échelle (quelques classes sur quelques jours) ne justifie pas la charge
d'exploitation de k8s.

## Conséquences

- « Haute disponibilité » signifie ici redémarrage automatique des conteneurs + un
  Postgres de secours à chaud + des sauvegardes maîtrisées — pas une disponibilité
  multi-zones de niveau fournisseur. Compromis accepté vu l'échelle et la priorité donnée à
  l'effacement.
- Une machine unique reste un domaine de panne ; un second serveur (principal + secours)
  est la topologie prévue si la disponibilité compte pendant l'événement.
