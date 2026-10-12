// What the teacher should do now, per phase: a pure function, so every branch is cheap to pin.
import { describe, it, expect } from "vitest";
import type { TripProgress } from "@trip/shared";
import { nowPlan, relTime, type PlanInput } from "../src/routes/teacher/now-plan.js";

const NOW = new Date("2030-01-01T12:00:00Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();
const ch = (o: Partial<TripProgress["challenges"][number]> = {}) => ({
  id: "c1", title: "Gelato", teamsWithPhotos: 0, pending: 0, approved: 0, rejected: 0, ...o,
});
const input = (o: Partial<PlanInput> = {}): PlanInput => ({
  phase: "draft",
  trip: { challenge_opens_at: null, voting_opens_at: null, voting_closes_at: null },
  progress: { students: 0, teams: 0, studentsWithoutTeam: 0, teamsUnreviewed: 0, voters: 0, challenges: [], eraseAt: inDays(60), graceEndsAt: null },
  roster: { pending: 0, done: 0, failed: 0, students: 0 },
  now: NOW,
  ...o,
});
const progress = (o: Partial<TripProgress>) => ({ ...input().progress, ...o });
const check = (plan: ReturnType<typeof nowPlan>, title: RegExp) => plan.checks.find((c) => title.test(c.title))!;

describe("relTime", () => {
  it.each([
    [30 * 60_000, "dans 30 minutes"],
    [5 * 3_600_000, "dans 5 heures"],
    [86_400_000 * 1.2, "demain"],
    [86_400_000 * 3, "dans 3 jours"],
    [-86_400_000 * 3, "il y a 3 jours"],
  ])("%d ms → %s", (ms, text) => {
    expect(relTime(new Date(NOW.getTime() + ms).toISOString(), NOW)).toBe(text);
  });
});

describe("draft", () => {
  it("starts with everything to do", () => {
    const plan = nowPlan(input());
    expect(plan.title).toBe("Préparation");
    expect(plan.checks.map((c) => [c.title, c.state])).toEqual([
      ["Ajouter des défis", "todo"],
      ["Importer la liste d'élèves", "todo"],
      ["Les élèves forment les équipes", "todo"],
      ["Planifier les dates", "todo"],
    ]);
    expect(check(plan, /défis/).to).toBe("challenges");
    expect(check(plan, /liste d'élèves/).to).toBe("students");
    expect(check(plan, /dates/).to).toBe("settings");
  });

  it("tracks codes being emailed, failures, and teams forming", () => {
    let plan = nowPlan(input({
      roster: { pending: 2, done: 3, failed: 0, students: 5 },
      progress: progress({ students: 5, teams: 1, studentsWithoutTeam: 3 }),
    }));
    expect(check(plan, /liste d'élèves/)).toMatchObject({ state: "doing", meta: "3 codes envoyés sur 5" });
    expect(check(plan, /équipes/)).toMatchObject({ state: "doing", meta: "3 sans équipe" });

    plan = nowPlan(input({ roster: { pending: 0, done: 4, failed: 1, students: 5 } }));
    expect(check(plan, /liste d'élèves/)).toMatchObject({ state: "doing", meta: "1 e-mail en échec — vérifie l'adresse" });

    plan = nowPlan(input({
      roster: { pending: 0, done: 5, failed: 0, students: 5 },
      progress: progress({ students: 5, teams: 2, studentsWithoutTeam: 0, challenges: [ch(), ch({ id: "c2" })] }),
      trip: { challenge_opens_at: inDays(3), voting_opens_at: null, voting_closes_at: null },
    }));
    expect(plan.checks.every((c) => c.state === "done")).toBe(true);
    expect(check(plan, /défis/).meta).toBe("2 défis");
    expect(check(plan, /liste d'élèves/).meta).toBe("5 codes envoyés");
    expect(check(plan, /équipes/).meta).toBe("5 élèves dans 2 équipes");
    expect(check(plan, /dates/).meta).toBe("Les défis commencent dans 3 jours");
  });

  it("starts the challenge, warning about students still without a team", () => {
    const plan = nowPlan(input({ progress: progress({ students: 5, studentsWithoutTeam: 2 }) }));
    expect(plan.action).toMatchObject({ label: "Lancer les défis", to: "challenge" });
    expect(plan.action!.confirm).toMatch(/équipes sont verrouillées/);
    expect(plan.action!.confirm).toMatch(/2 élèves n'ont pas encore d'équipe/);
    expect(nowPlan(input()).action!.confirm).not.toMatch(/pas encore d'équipe/);
  });
});

describe("challenge", () => {
  it("shows each challenge's entries and the review queue", () => {
    const plan = nowPlan(input({
      phase: "challenge",
      progress: progress({ teams: 4, challenges: [ch({ teamsWithPhotos: 4 }), ch({ id: "c2", title: "Tower", teamsWithPhotos: 1 }), ch({ id: "c3", title: "Bridge" })] }),
      pending: 2,
      trip: { challenge_opens_at: null, voting_opens_at: inDays(2), voting_closes_at: null },
    }));
    expect(plan.title).toBe("Défis en cours");
    expect(plan.checks.map((c) => [c.title, c.state, c.meta])).toEqual([
      ["Gelato", "done", "4 équipes sur 4 ont participé"],
      ["Tower", "doing", "1 équipe sur 4 a participé"],
      ["Bridge", "todo", "0 équipe sur 4 a participé"],
      ["Modérer les photos en lice", "doing", "2 en attente"],
      ["Vérifier les noms d'équipe", "done", "Tous vérifiés"],
    ]);
    expect(check(plan, /Modérer/).to).toBe("review");
    expect(plan.when).toBe("Le vote ouvre après-demain");
    expect(plan.action).toMatchObject({ label: "Ouvrir le vote", to: "voting" });
    expect(plan.action!.confirm).toMatch(/L'envoi de photos se ferme/);
  });

  it("drops the review line when nothing waits", () => {
    const plan = nowPlan(input({ phase: "challenge", progress: progress({ teams: 1, challenges: [ch()] }) }));
    expect(plan.checks.find((c) => /Modérer/.test(c.title))).toBeUndefined();
    expect(plan.when).toBeUndefined();
  });
});

describe("voting", () => {
  it("flags challenges without 3 approved teams (no duel can be formed)", () => {
    const plan = nowPlan(input({
      phase: "voting",
      progress: progress({ challenges: [ch({ approved: 3 }), ch({ id: "c2", title: "Tower", approved: 2, pending: 1 })] }),
      pending: 1,
      trip: { challenge_opens_at: null, voting_opens_at: null, voting_closes_at: inDays(-1) },
    }));
    expect(plan.title).toBe("Vote");
    expect(plan.checks.map((c) => [c.title, c.state, c.meta])).toEqual([
      ["Gelato", "done", "3 validées — ouvert au vote"],
      ["Tower", "todo", "2 validées — il en faut 3 pour voter"],
      ["Modérer les photos en lice", "doing", "1 en attente"],
    ]);
    expect(plan.when).toBe("Le vote s'est fermé hier");
    expect(plan.action).toMatchObject({ label: "Fermer le vote et calculer les résultats", to: "reveal" });
    expect(plan.action!.confirm).toMatch(/qu'après la cérémonie/);
  });

  it("says when voting closes", () => {
    const plan = nowPlan(input({ phase: "voting", trip: { challenge_opens_at: null, voting_opens_at: null, voting_closes_at: inDays(1.2) } }));
    expect(plan.when).toBe("Le vote se ferme demain");
  });
});

describe("team names and voting participation (#96)", () => {
  it("asks to check team names from the challenge until the reveal, linking to the teams", () => {
    for (const phase of ["challenge", "voting"]) {
      const plan = nowPlan(input({ phase, progress: progress({ teams: 3, teamsUnreviewed: 2 }) }));
      expect(check(plan, /noms d'équipe/)).toEqual({ title: "Vérifier les noms d'équipe", state: "doing", meta: "2 non vérifiés", to: "students" });
    }
    const allGood = nowPlan(input({ phase: "challenge", progress: progress({ teams: 3, teamsUnreviewed: 0 }) }));
    expect(check(allGood, /noms d'équipe/)).toMatchObject({ state: "done", meta: "Tous vérifiés" });
    expect(nowPlan(input({ phase: "challenge" })).checks.find((c) => /noms d'équipe/.test(c.title))).toBeUndefined(); // no teams
  });

  it("warns, without blocking, that unchecked names show at the ceremony then become labels", () => {
    const plan = nowPlan(input({ phase: "voting", progress: progress({ teams: 3, teamsUnreviewed: 2 }) }));
    expect(plan.action!.confirm).toMatch(/2 noms d'équipe ne sont pas vérifiés : ils s'afficheront à la cérémonie, puis deviendront « Équipe N » après l'effacement/);
    expect(nowPlan(input({ phase: "voting", progress: progress({ teams: 3 }) })).action!.confirm).not.toMatch(/ne sont pas vérifiés/);
  });

  it("shows how many students have voted — never who", () => {
    const row = (voters: number) => check(nowPlan(input({ phase: "voting", progress: progress({ students: 22, voters }) })), /ayant voté/);
    expect(row(14)).toEqual({ title: "Élèves ayant voté", state: "doing", meta: "14 sur 22" });
    expect(row(0).state).toBe("todo");
    expect(row(22).state).toBe("done");
  });

  it("links roster problems straight to the matching filter", () => {
    const plan = nowPlan(input({
      roster: { pending: 0, done: 4, failed: 1, students: 5 },
      progress: progress({ students: 5, teams: 1, studentsWithoutTeam: 2 }),
    }));
    expect(check(plan, /liste d'élèves/).to).toBe("students?filter=undelivered");
    expect(check(plan, /équipes/).to).toBe("students?filter=no-team");
  });
});

describe("reveal, grace, erased", () => {
  it("reveal: run the ceremony, then publish", () => {
    const plan = nowPlan(input({ phase: "reveal", progress: progress({ graceEndsAt: inDays(7) }) }));
    expect(plan.title).toBe("C'est l'heure de la cérémonie");
    expect(plan.checks).toEqual([{ title: "Animer la cérémonie", state: "todo", to: "results", meta: "Projette-la depuis Résultats" }]);
    expect(plan.action).toMatchObject({ label: "Publier les résultats", to: "grace" });
    expect(plan.action!.confirm).toMatch(/visibles pour les élèves/);
    expect(plan.action!.confirm).toMatch(/effacées dans 7 jours/);
  });

  it("grace: results are out; erasure is the next thing", () => {
    const plan = nowPlan(input({ phase: "grace", progress: progress({ eraseAt: inDays(4) }) }));
    expect(plan.title).toBe("Résultats publiés");
    expect(plan.action).toBeUndefined();
    expect(plan.when).toBe("Les données des élèves seront effacées dans 4 jours");
  });

  it("erased: nothing left to do", () => {
    const plan = nowPlan(input({ phase: "erased" }));
    expect(plan).toEqual({ title: "Sortie effacée", checks: [] });
  });
});

describe("erasure warning", () => {
  it("warns within 7 days of erasure, whatever the phase", () => {
    expect(nowPlan(input({ progress: progress({ eraseAt: inDays(3) }) })).eraseWarning)
      .toBe("Les données des élèves seront effacées dans 3 jours.");
    expect(nowPlan(input({ progress: progress({ eraseAt: inDays(8) }) })).eraseWarning).toBeUndefined();
    expect(nowPlan(input({ phase: "erased", progress: progress({ eraseAt: inDays(1) }) })).eraseWarning).toBeUndefined();
  });

  it("doesn't repeat itself in grace, where it is already the headline", () => {
    expect(nowPlan(input({ phase: "grace", progress: progress({ eraseAt: inDays(3) }) })).eraseWarning).toBeUndefined();
  });
});
