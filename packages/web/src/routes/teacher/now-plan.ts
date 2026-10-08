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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
/** "in 3 days", "tomorrow", "in 5 hours", "2 days ago". */
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
    ? [{ title: "Review nominations", state: "doing", meta: `${pending} waiting`, to: "review" }]
    : [];
  // Team names are only kept after the trip if a teacher checked them (ADR 0007).
  const unchecked = progress.teamsUnreviewed;
  const names: PlanCheck[] = progress.teams > 0
    ? [unchecked > 0
      ? { title: "Check team names", state: "doing", meta: `${unchecked} not checked`, to: "students" }
      : { title: "Check team names", state: "done", meta: "All checked", to: "students" }]
    : [];
  const plan = planFor();
  const untilErasure = new Date(progress.eraseAt).getTime() - now.getTime();
  if (phase !== "grace" && phase !== "erased" && untilErasure <= WARN_BEFORE_ERASURE) {
    plan.eraseWarning = `Student data will be erased ${rel(progress.eraseAt)}.`;
  }
  return plan;

  function planFor(): Plan {
    switch (phase) {
      case "draft": {
        const n = progress.challenges.length;
        const { students, teams, studentsWithoutTeam: loose } = progress;
        const rosterCheck: PlanCheck = roster.failed > 0
          ? { title: "Import the roster", state: "doing", meta: roster.failed === 1 ? "1 email failed — check the address" : `${roster.failed} emails failed — check the addresses` }
          : roster.pending > 0
            ? { title: "Import the roster", state: "doing", meta: `${roster.done} of ${roster.students} codes emailed` }
            : roster.students > 0
              ? { title: "Import the roster", state: "done", meta: `${roster.done} codes emailed` }
              : { title: "Import the roster", state: "todo", meta: "Paste the students' emails" };
        const teamCheck: PlanCheck = students === 0
          ? { title: "Students form teams", state: "todo", meta: "Once they've joined" }
          : loose > 0
            ? { title: "Students form teams", state: teams > 0 ? "doing" : "todo", meta: `${loose} without a team` }
            : { title: "Students form teams", state: "done", meta: `${plural(students, "student")} in ${plural(teams, "team")}` };
        return {
          title: "Getting ready",
          checks: [
            { title: "Add challenges", state: n > 0 ? "done" : "todo", meta: n > 0 ? plural(n, "challenge") : undefined, to: "challenges" },
            { ...rosterCheck, to: roster.failed > 0 ? "students?filter=undelivered" : "students" },
            { ...teamCheck, to: loose > 0 ? "students?filter=no-team" : "students" },
            trip.challenge_opens_at
              ? { title: "Plan the dates", state: "done", meta: `Challenge opens ${rel(trip.challenge_opens_at)}`, to: "settings" }
              : { title: "Plan the dates", state: "todo", meta: "Optional — or start the challenge yourself", to: "settings" },
          ],
          action: {
            label: "Start the challenge", to: "challenge",
            confirm: "Teams lock and students can start uploading photos."
              + (loose > 0 ? ` ${plural(loose, "student")} ${loose === 1 ? "has" : "have"} no team yet and won't be able to take part.` : ""),
          },
        };
      }
      case "challenge":
        return {
          title: "Challenge under way",
          checks: [
            ...progress.challenges.map((c): PlanCheck => ({
              title: c.title,
              state: progress.teams > 0 && c.teamsWithPhotos >= progress.teams ? "done" : c.teamsWithPhotos > 0 ? "doing" : "todo",
              meta: `${c.teamsWithPhotos} of ${progress.teams} teams entered`,
              to: "challenges",
            })),
            ...review,
            ...names,
          ],
          when: trip.voting_opens_at ? `Voting opens ${rel(trip.voting_opens_at)}` : undefined,
          action: {
            label: "Open voting", to: "voting",
            confirm: "Uploads close. Teams that didn't nominate a photo get their latest one nominated."
              + (pending > 0 ? ` ${plural(pending, "nomination")} still ${pending === 1 ? "waits" : "wait"} for review.` : ""),
          },
        };
      case "voting": {
        const closes = trip.voting_closes_at;
        return {
          title: "Voting",
          checks: [
            ...progress.challenges.map((c): PlanCheck => ({
              title: c.title,
              state: c.approved >= VOTABLE ? "done" : "todo",
              meta: c.approved >= VOTABLE ? `${c.approved} approved — votable` : `${c.approved} approved — needs ${VOTABLE} to be votable`,
              to: "review",
            })),
            ...review,
            ...names,
            ...(progress.students > 0 ? [{
              title: "Students who voted",
              state: progress.voters === 0 ? "todo" : progress.voters >= progress.students ? "done" : "doing",
              meta: `${progress.voters} of ${progress.students}`,
            } satisfies PlanCheck] : []),
          ],
          when: closes ? `Voting ${new Date(closes) <= now ? "closed" : "closes"} ${rel(closes)}` : undefined,
          action: {
            label: "Close voting & compute results", to: "reveal",
            confirm: "Voting stops and results are computed. Students see them only after the ceremony."
              + (unchecked > 0
                ? ` ${plural(unchecked, "team name")} ${unchecked === 1 ? "isn't" : "aren't"} checked: they'll show at the ceremony, then become “Team N” after erasure.`
                : ""),
          },
        };
      }
      case "reveal":
        return {
          title: "Ceremony time",
          checks: [{ title: "Run the ceremony", state: "todo", to: "results", meta: "Project it from Results" }],
          action: {
            label: "Publish results", to: "grace",
            confirm: "Results become visible to students. "
              + (progress.graceEndsAt ? `Student data is erased ${rel(progress.graceEndsAt)}.` : "Student data is erased after the grace period."),
          },
        };
      case "grace":
        return { title: "Results published", checks: [], when: `Student data is erased ${rel(progress.eraseAt)}` };
      default:
        return { title: "Trip erased", checks: [] };
    }
  }
}
