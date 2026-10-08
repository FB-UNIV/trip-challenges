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
  progress: { students: 0, teams: 0, studentsWithoutTeam: 0, challenges: [], eraseAt: inDays(60), graceEndsAt: null },
  roster: { pending: 0, done: 0, failed: 0, students: 0 },
  now: NOW,
  ...o,
});
const progress = (o: Partial<TripProgress>) => ({ ...input().progress, ...o });
const check = (plan: ReturnType<typeof nowPlan>, title: RegExp) => plan.checks.find((c) => title.test(c.title))!;

describe("relTime", () => {
  it.each([
    [30 * 60_000, "in 30 minutes"],
    [5 * 3_600_000, "in 5 hours"],
    [86_400_000 * 1.2, "tomorrow"],
    [86_400_000 * 3, "in 3 days"],
    [-86_400_000 * 2, "2 days ago"],
  ])("%d ms → %s", (ms, text) => {
    expect(relTime(new Date(NOW.getTime() + ms).toISOString(), NOW)).toBe(text);
  });
});

describe("draft", () => {
  it("starts with everything to do", () => {
    const plan = nowPlan(input());
    expect(plan.title).toBe("Getting ready");
    expect(plan.checks.map((c) => [c.title, c.state])).toEqual([
      ["Add challenges", "todo"],
      ["Import the roster", "todo"],
      ["Students form teams", "todo"],
      ["Plan the dates", "todo"],
    ]);
    expect(check(plan, /challenges/).to).toBe("challenges");
    expect(check(plan, /roster/).to).toBe("students");
    expect(check(plan, /dates/).to).toBe("settings");
  });

  it("tracks codes being emailed, failures, and teams forming", () => {
    let plan = nowPlan(input({
      roster: { pending: 2, done: 3, failed: 0, students: 5 },
      progress: progress({ students: 5, teams: 1, studentsWithoutTeam: 3 }),
    }));
    expect(check(plan, /roster/)).toMatchObject({ state: "doing", meta: "3 of 5 codes emailed" });
    expect(check(plan, /teams/)).toMatchObject({ state: "doing", meta: "3 without a team" });

    plan = nowPlan(input({ roster: { pending: 0, done: 4, failed: 1, students: 5 } }));
    expect(check(plan, /roster/)).toMatchObject({ state: "doing", meta: "1 email failed — check the address" });

    plan = nowPlan(input({
      roster: { pending: 0, done: 5, failed: 0, students: 5 },
      progress: progress({ students: 5, teams: 2, studentsWithoutTeam: 0, challenges: [ch(), ch({ id: "c2" })] }),
      trip: { challenge_opens_at: inDays(3), voting_opens_at: null, voting_closes_at: null },
    }));
    expect(plan.checks.every((c) => c.state === "done")).toBe(true);
    expect(check(plan, /challenges/).meta).toBe("2 challenges");
    expect(check(plan, /roster/).meta).toBe("5 codes emailed");
    expect(check(plan, /teams/).meta).toBe("5 students in 2 teams");
    expect(check(plan, /dates/).meta).toBe("Challenge opens in 3 days");
  });

  it("starts the challenge, warning about students still without a team", () => {
    const plan = nowPlan(input({ progress: progress({ students: 5, studentsWithoutTeam: 2 }) }));
    expect(plan.action).toMatchObject({ label: "Start the challenge", to: "challenge" });
    expect(plan.action!.confirm).toMatch(/Teams lock/);
    expect(plan.action!.confirm).toMatch(/2 students have no team yet/);
    expect(nowPlan(input()).action!.confirm).not.toMatch(/no team yet/);
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
    expect(plan.title).toBe("Challenge under way");
    expect(plan.checks.map((c) => [c.title, c.state, c.meta])).toEqual([
      ["Gelato", "done", "4 of 4 teams entered"],
      ["Tower", "doing", "1 of 4 teams entered"],
      ["Bridge", "todo", "0 of 4 teams entered"],
      ["Review nominations", "doing", "2 waiting"],
    ]);
    expect(check(plan, /Review/).to).toBe("review");
    expect(plan.when).toBe("Voting opens in 2 days");
    expect(plan.action).toMatchObject({ label: "Open voting", to: "voting" });
    expect(plan.action!.confirm).toMatch(/Uploads close/);
  });

  it("drops the review line when nothing waits", () => {
    const plan = nowPlan(input({ phase: "challenge", progress: progress({ teams: 1, challenges: [ch()] }) }));
    expect(plan.checks.find((c) => /Review/.test(c.title))).toBeUndefined();
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
    expect(plan.title).toBe("Voting");
    expect(plan.checks.map((c) => [c.title, c.state, c.meta])).toEqual([
      ["Gelato", "done", "3 approved — votable"],
      ["Tower", "todo", "2 approved — needs 3 to be votable"],
      ["Review nominations", "doing", "1 waiting"],
    ]);
    expect(plan.when).toBe("Voting closed 1 day ago");
    expect(plan.action).toMatchObject({ label: "Close voting & compute results", to: "reveal" });
    expect(plan.action!.confirm).toMatch(/only after the ceremony/);
  });

  it("says when voting closes", () => {
    const plan = nowPlan(input({ phase: "voting", trip: { challenge_opens_at: null, voting_opens_at: null, voting_closes_at: inDays(1.2) } }));
    expect(plan.when).toBe("Voting closes tomorrow");
  });
});

describe("reveal, grace, erased", () => {
  it("reveal: run the ceremony, then publish", () => {
    const plan = nowPlan(input({ phase: "reveal", progress: progress({ graceEndsAt: inDays(7) }) }));
    expect(plan.title).toBe("Ceremony time");
    expect(plan.checks).toEqual([{ title: "Run the ceremony", state: "todo", to: "results", meta: "Project it from Results" }]);
    expect(plan.action).toMatchObject({ label: "Publish results", to: "grace" });
    expect(plan.action!.confirm).toMatch(/visible to students/);
    expect(plan.action!.confirm).toMatch(/erased in 7 days/);
  });

  it("grace: results are out; erasure is the next thing", () => {
    const plan = nowPlan(input({ phase: "grace", progress: progress({ eraseAt: inDays(4) }) }));
    expect(plan.title).toBe("Results published");
    expect(plan.action).toBeUndefined();
    expect(plan.when).toBe("Student data is erased in 4 days");
  });

  it("erased: nothing left to do", () => {
    const plan = nowPlan(input({ phase: "erased" }));
    expect(plan).toMatchObject({ title: "Trip erased", checks: [], action: undefined });
  });
});

describe("erasure warning", () => {
  it("warns within 7 days of erasure, whatever the phase", () => {
    expect(nowPlan(input({ progress: progress({ eraseAt: inDays(3) }) })).eraseWarning)
      .toBe("Student data will be erased in 3 days.");
    expect(nowPlan(input({ progress: progress({ eraseAt: inDays(8) }) })).eraseWarning).toBeUndefined();
    expect(nowPlan(input({ phase: "erased", progress: progress({ eraseAt: inDays(1) }) })).eraseWarning).toBeUndefined();
  });

  it("doesn't repeat itself in grace, where it is already the headline", () => {
    expect(nowPlan(input({ phase: "grace", progress: progress({ eraseAt: inDays(3) }) })).eraseWarning).toBeUndefined();
  });
});
