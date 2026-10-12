// What the teacher should do now: per phase, a checklist of what's ready, the next planned
// date, an erasure warning, and the one action that moves the trip on (with what it does).
import type { TripProgress } from "@trip/shared";
import type { CheckState } from "../../ui.js";

export type PlanInput = {
  phase: string;
  trip: { challenge_opens_at: string | null; voting_opens_at: string | null; voting_closes_at: string | null };
  progress: TripProgress;
  roster: { pending: number; done: number; failed: number; students: number };
  /** Nominations waiting for review. */
  pending?: number;
  now?: Date;
};
/** `to`: the trip section where this is dealt with. */
export type PlanCheck = { title: string; state: CheckState; meta?: string; to?: string };
/** `to`: the phase the action advances to; `confirm`: what that does, shown before doing it. */
export type PlanAction = { label: string; to: string; confirm: string };
export type Plan = { title: string; checks: PlanCheck[]; when?: string; action?: PlanAction; eraseWarning?: string };

/** A challenge needs this many teams with approved nominations before a duel can be formed. */
const VOTABLE = 3;
const DAY = 86_400_000;
const WARN_BEFORE_ERASURE = 7 * DAY;

// French: 0 and 1 take the singular.
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n <= 1 ? one : many}`;

const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
/** "dans 3 jours", "demain", "dans 5 heures", "il y a 2 jours". */
export function relTime(iso: string, now = new Date()): string {
  const ms = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(ms);
  if (abs < 3_600_000) return rtf.format(Math.round(ms / 60_000), "minute");
  if (abs < DAY) return rtf.format(Math.round(ms / 3_600_000), "hour");
  return rtf.format(Math.round(ms / DAY), "day");
}

export function nowPlan({ phase, trip, progress, roster, pending = 0, now = new Date() }: PlanInput): Plan {
  const rel = (iso: string) => relTime(iso, now);
  const review: PlanCheck[] = pending > 0
    ? [{ title: "Modérer les photos en lice", state: "doing", meta: `${pending} en attente`, to: "review" }]
    : [];
  // Team names are only kept after the trip if a teacher checked them (ADR 0007).
  const unchecked = progress.teamsUnreviewed;
  const names: PlanCheck[] = progress.teams > 0
    ? [unchecked > 0
      ? { title: "Vérifier les noms d'équipe", state: "doing", meta: `${plural(unchecked, "non vérifié", "non vérifiés")}`, to: "students" }
      : { title: "Vérifier les noms d'équipe", state: "done", meta: "Tous vérifiés", to: "students" }]
    : [];
  const plan = planFor();
  const untilErasure = new Date(progress.eraseAt).getTime() - now.getTime();
  if (phase !== "grace" && phase !== "erased" && untilErasure <= WARN_BEFORE_ERASURE) {
    plan.eraseWarning = `Les données des élèves seront effacées ${rel(progress.eraseAt)}.`;
  }
  return plan;

  function planFor(): Plan {
    switch (phase) {
      case "draft": {
        const n = progress.challenges.length;
        const { students, teams, studentsWithoutTeam: loose } = progress;
        const rosterCheck: PlanCheck = roster.failed > 0
          ? { title: "Importer la liste d'élèves", state: "doing", meta: roster.failed === 1 ? "1 e-mail en échec — vérifie l'adresse" : `${roster.failed} e-mails en échec — vérifie les adresses` }
          : roster.pending > 0
            ? { title: "Importer la liste d'élèves", state: "doing", meta: `${roster.done} codes envoyés sur ${roster.students}` }
            : roster.students > 0
              ? { title: "Importer la liste d'élèves", state: "done", meta: `${plural(roster.done, "code envoyé", "codes envoyés")}` }
              : { title: "Importer la liste d'élèves", state: "todo", meta: "Colle les e-mails des élèves" };
        const teamCheck: PlanCheck = students === 0
          ? { title: "Les élèves forment les équipes", state: "todo", meta: "Une fois inscrits" }
          : loose > 0
            ? { title: "Les élèves forment les équipes", state: teams > 0 ? "doing" : "todo", meta: `${loose} sans équipe` }
            : { title: "Les élèves forment les équipes", state: "done", meta: `${plural(students, "élève")} dans ${plural(teams, "équipe")}` };
        return {
          title: "Préparation",
          checks: [
            { title: "Ajouter des défis", state: n > 0 ? "done" : "todo", meta: n > 0 ? plural(n, "défi") : undefined, to: "challenges" },
            { ...rosterCheck, to: roster.failed > 0 ? "students?filter=undelivered" : "students" },
            { ...teamCheck, to: loose > 0 ? "students?filter=no-team" : "students" },
            trip.challenge_opens_at
              ? { title: "Planifier les dates", state: "done", meta: `Les défis commencent ${rel(trip.challenge_opens_at)}`, to: "settings" }
              : { title: "Planifier les dates", state: "todo", meta: "Facultatif — ou lance les défis toi-même", to: "settings" },
          ],
          action: {
            label: "Lancer les défis", to: "challenge",
            confirm: "Les équipes sont verrouillées et les élèves peuvent envoyer des photos."
              + (loose > 0 ? ` ${plural(loose, "élève n'a", "élèves n'ont")} pas encore d'équipe et ne ${loose === 1 ? "pourra" : "pourront"} pas participer.` : ""),
          },
        };
      }
      case "challenge":
        return {
          title: "Défis en cours",
          checks: [
            ...progress.challenges.map((c): PlanCheck => ({
              title: c.title,
              state: progress.teams > 0 && c.teamsWithPhotos >= progress.teams ? "done" : c.teamsWithPhotos > 0 ? "doing" : "todo",
              meta: `${plural(c.teamsWithPhotos, "équipe")} sur ${progress.teams} ${c.teamsWithPhotos <= 1 ? "a" : "ont"} participé`,
              to: "challenges",
            })),
            ...review,
            ...names,
          ],
          when: trip.voting_opens_at ? `Le vote ouvre ${rel(trip.voting_opens_at)}` : undefined,
          action: {
            label: "Ouvrir le vote", to: "voting",
            confirm: "L'envoi de photos se ferme. Les équipes qui n'ont pas sélectionné de photo voient leur dernière photo sélectionnée."
              + (pending > 0 ? ` ${plural(pending, "photo attend", "photos attendent")} encore d'être modérée${pending > 1 ? "s" : ""}.` : ""),
          },
        };
      case "voting": {
        const closes = trip.voting_closes_at;
        return {
          title: "Vote",
          checks: [
            ...progress.challenges.map((c): PlanCheck => ({
              title: c.title,
              state: c.approved >= VOTABLE ? "done" : "todo",
              meta: c.approved >= VOTABLE ? `${plural(c.approved, "validée", "validées")} — ouvert au vote` : `${plural(c.approved, "validée", "validées")} — il en faut ${VOTABLE} pour voter`,
              to: "review",
            })),
            ...review,
            ...names,
            ...(progress.students > 0 ? [{
              title: "Élèves ayant voté",
              state: progress.voters === 0 ? "todo" : progress.voters >= progress.students ? "done" : "doing",
              meta: `${progress.voters} sur ${progress.students}`,
            } satisfies PlanCheck] : []),
          ],
          when: closes ? `Le vote ${new Date(closes) <= now ? "s'est fermé" : "se ferme"} ${rel(closes)}` : undefined,
          action: {
            label: "Fermer le vote et calculer les résultats", to: "reveal",
            confirm: "Le vote s'arrête et les résultats sont calculés. Les élèves ne les voient qu'après la cérémonie."
              + (unchecked > 0
                ? ` ${plural(unchecked, "nom d'équipe n'est pas vérifié", "noms d'équipe ne sont pas vérifiés")} : ${unchecked === 1 ? "il s'affichera" : "ils s'afficheront"} à la cérémonie, puis deviendr${unchecked === 1 ? "a" : "ont"} « Équipe N » après l'effacement.`
                : ""),
          },
        };
      }
      case "reveal":
        return {
          title: "C'est l'heure de la cérémonie",
          checks: [{ title: "Animer la cérémonie", state: "todo", to: "results", meta: "Projette-la depuis Résultats" }],
          action: {
            label: "Publier les résultats", to: "grace",
            confirm: "Les résultats deviennent visibles pour les élèves. "
              + (progress.graceEndsAt ? `Les données des élèves seront effacées ${rel(progress.graceEndsAt)}.` : "Les données des élèves seront effacées après le délai de grâce."),
          },
        };
      case "grace":
        return { title: "Résultats publiés", checks: [], when: `Les données des élèves seront effacées ${rel(progress.eraseAt)}` };
      default:
        return { title: "Sortie effacée", checks: [] };
    }
  }
}
