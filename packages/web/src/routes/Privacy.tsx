// What the app keeps about a student, who sees it, and when it is erased — for students and
// their families. The school is the data controller (ADR 0004): rights go through it.
import { Link } from "react-router-dom";
import { Card } from "../ui.js";

export function Privacy() {
  return (
    <div className="stack">
      <Card hero>
        <h2>Tes données et ta vie privée</h2>
        <p className="muted mb-0">
          Cette application sert aux sorties scolaires organisées par ton établissement. Elle garde
          le moins de choses possible sur toi, et efface tout à la fin de la sortie.
        </p>
      </Card>

      <Card>
        <h3>Ce que l'application garde</h3>
        <ul>
          <li><b>Ton adresse e-mail</b>, donnée par ton enseignant pour t'envoyer ton code d'accès. Elle est chiffrée.</li>
          <li><b>Les photos</b> envoyées par ton équipe. Elles sont chiffrées, et leurs métadonnées (dont la position GPS) sont supprimées à l'envoi.</li>
          <li><b>Ton équipe</b> et son nom, et <b>tes votes</b> pendant les duels.</li>
          <li>Un <b>cookie de session</b>, pour que tu restes connecté sur ton téléphone. Pas de publicité, pas de mesure d'audience, aucun pistage.</li>
        </ul>
      </Card>

      <Card>
        <h3>Qui voit quoi</h3>
        <ul>
          <li>Pendant les défis, les photos de ton équipe ne sont visibles que par ton équipe… et par tes enseignants.</li>
          <li>Seule la photo que ton équipe met en lice, une fois validée par un enseignant, est montrée aux autres élèves pendant le vote, sans ton nom.</li>
          <li>Tes enseignants voient ton adresse e-mail, si tu es inscrit et ton équipe. Ils peuvent retirer n'importe quelle photo. Ils voient combien d'élèves ont voté, jamais pour qui tu as voté.</li>
        </ul>
      </Card>

      <Card>
        <h3>Quand tout est effacé</h3>
        <p className="mt-0">
          Après la cérémonie et un délai de grâce choisi par ton enseignant (7 jours en général), tout
          est effacé automatiquement : ton e-mail, toutes les photos (même celles des gagnants), les
          équipes et les votes. Quoi qu'il arrive, l'effacement a lieu au plus tard peu après la fin de
          la sortie (30 jours par défaut).
        </p>
        <p className="mb-0">
          Il ne reste que les résultats : le titre de chaque défi, la place, les points et le nom de
          l'équipe — seulement si un enseignant l'a vérifié, sinon il devient « Équipe 1 », « Équipe 2 »…
          Aucune photo, aucun nom d'élève.
        </p>
      </Card>

      <Card>
        <h3>Tes droits</h3>
        <p className="mt-0 mb-0">
          C'est ton établissement qui est responsable de ces données. Pour toute question, ou pour
          demander l'accès, la correction ou l'effacement de tes données, adresse-toi à ton enseignant
          ou au délégué à la protection des données (DPO) de ton établissement. Tu peux aussi saisir la
          CNIL (<a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer">cnil.fr</a>).
        </p>
      </Card>

      <p className="center tiny"><Link to="/">← Retour à l'accueil</Link></p>
    </div>
  );
}
