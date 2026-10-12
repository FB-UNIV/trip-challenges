# Import de la liste d'élèves, l'établissement étant responsable de traitement

Les adresses e-mail des élèves (données personnelles de mineurs) n'entrent dans le système
que par l'import en masse d'une liste par un enseignant ; le système envoie à chaque élève
un code d'accès. L'**établissement est responsable de traitement** et détient le
consentement parental hors ligne ; ce système agit comme **sous-traitant**. La charge du
consentement et la base légale restent ainsi auprès de l'institution qui entretient déjà
la relation avec les familles, et nos données personnelles se limitent à un seul champ
(l'e-mail), détruit à l'effacement.

## Options envisagées

- **Les élèves enregistrent eux-mêmes leur e-mail** — rejetée : collecter des données
  personnelles directement auprès de mineurs ferait de nous le responsable de traitement et
  exigerait un parcours de consentement parental dans l'application.
- **Aucun e-mail (l'enseignant distribue les codes sur papier)** — l'option la plus
  économe en données personnelles, et une vraie alternative ; écartée au profit des codes
  envoyés par e-mail pour la commodité de distribution, en acceptant la surface d'attaque
  et d'effacement supplémentaire de l'e-mail.

## Conséquences

- Nous ne devons jamais traiter la liste comme nos propres données : aucune réutilisation,
  aucun export, suppression à l'effacement (y compris les journaux de distribution des
  e-mails).
- Les noms d'équipe et tout texte libre doivent être traités comme des données
  personnelles potentielles et vérifiés avant d'apparaître dans les résultats conservés
  (après effacement).
- Le hachage suit l'entropie du secret : les codes d'accès (saisis à la main, de courte
  durée) utilisent argon2 ; les jetons de session d'appareil et d'invitation des
  co-enseignants (aléas de 256 bits) utilisent SHA-256, car ils sont vérifiés à chaque
  requête et ne peuvent pas être forcés hors ligne (#64).
