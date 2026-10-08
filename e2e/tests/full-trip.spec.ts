// The whole product in one story: a teacher runs a trip with three teams of students on
// phones, from roster import to the ceremony and the final erasure of minors' data.
import { test, expect } from "@playwright/test";
import { signInTeacher, joinByEmail, uniqueEmail, unique, closeAll, type Student } from "../support/actors.js";
import { photo, asFile } from "../support/photos.js";
import { TripAdminPage } from "../pages/teacher.js";
import { TeamPage, ChallengePage, VotePage, StudentHomePage } from "../pages/student.js";
import { WEB_URL } from "../support/env.js";

test.setTimeout(240_000);

test("a full trip: roster → teams → photos → moderation → duels → ceremony → erasure", async ({ browser, playwright }) => {
  const teacher = await signInTeacher(browser);
  const admin = new TripAdminPage(teacher.page);
  const tripName = unique("Venice");
  const tripId = await teacher.api.createTrip(tripName);
  const teams = ["Foxes", "Owls", "Bears"] as const;
  const kids: Record<(typeof teams)[number], Student & { submissionId?: string }> = {} as never;
  let challengeId = "";
  let qrSlug = "";

  await test.step("teacher adds a challenge and imports the roster", async () => {
    await admin.goto(tripId);
    await admin.addChallenge("Best gelato", "Photograph the best gelato you can find");
    const emails = teams.map(() => uniqueEmail("kid"));
    await admin.importRoster(emails);
    const joined = await Promise.all(emails.map((e) => joinByEmail(browser, e)));
    teams.forEach((t, i) => (kids[t] = joined[i]!));
    const list = await (await teacher.api.r.get(`/api/challenges?tripId=${tripId}`)).json();
    ({ id: challengeId, qr_slug: qrSlug } = list.challenges[0]);
  });

  await test.step("each student forms a team on their phone", async () => {
    for (const t of teams) {
      const page = new TeamPage(kids[t].page);
      await page.goto();
      await page.create(t);
    }
  });

  await test.step("the challenge opens; every team uploads and nominates a photo", async () => {
    await admin.advanceTo("challenge");
    const colors = { Foxes: "#e4572e", Owls: "#29335c", Bears: "#f3a712" };
    for (const t of teams) {
      const ch = new ChallengePage(kids[t].page);
      await ch.goto(qrSlug);
      await ch.upload(asFile(await photo(colors[t])));
      await ch.nominate(0);
      const subs = await (await kids[t].api.r.get(`/api/submissions?challengeId=${challengeId}`)).json();
      kids[t].submissionId = subs.submissions[0].id;
    }
  });

  await test.step("voting opens; the teacher approves the three nominations", async () => {
    await admin.advanceTo("voting");
    await admin.approveAll(3);
  });

  await test.step("students vote in duels (never on their own team)", async () => {
    // Each voter sees exactly one pair (the two other teams). Picks make Foxes win 2/2,
    // Owls 1/2, Bears 0/2, so the ranking is deterministic.
    const picks: Record<(typeof teams)[number], (typeof teams)[number]> = { Foxes: "Owls", Owls: "Foxes", Bears: "Foxes" };
    for (const voter of teams) {
      const vote = new VotePage(kids[voter].page);
      await vote.goto(challengeId);
      await expect(vote.option(kids[voter].submissionId!)).toHaveCount(0);
      await vote.pick(kids[picks[voter]].submissionId!);
      await vote.expectAllJudged();
    }
  });

  await test.step("reveal: results computed, visible to the teacher only", async () => {
    await admin.advanceTo("reveal");
    await admin.open("Results");
    const results = admin.card("Results & ceremony");
    await expect(results.getByText("🏆 Foxes (5 pts)")).toBeVisible();
    await expect(results.getByText("Best gelato #1 — Foxes (5 pts)")).toBeVisible();
    await expect(results.getByText("Best gelato #2 — Owls (3 pts)")).toBeVisible();
    await expect(results.getByText("Best gelato #3 — Bears (1 pts)")).toBeVisible();

    const anon = await playwright.request.newContext({ baseURL: WEB_URL });
    expect((await (await anon.get(`/api/trips/${tripId}/results`)).json()).results).toEqual([]);
    await anon.dispose();

    await new StudentHomePage(kids.Bears.page).goto();
    await expect(kids.Bears.page.getByRole("heading", { name: "Results are in" })).toBeVisible();
  });

  await test.step("the projector ceremony steps through the podium to the Grand Champion", async () => {
    const [ceremony] = await Promise.all([
      teacher.context.waitForEvent("page"),
      admin.card("Results & ceremony").getByRole("button", { name: /Launch ceremony/ }).click(),
    ]);
    await expect(ceremony.getByRole("heading", { name: "And the winners are…" })).toBeVisible();
    await ceremony.getByRole("button", { name: "Reveal →" }).click();
    await expect(ceremony.getByRole("heading", { name: "Best gelato" })).toBeVisible();
    await expect(ceremony.getByText("Foxes")).toBeVisible();
    await ceremony.getByRole("button", { name: "Reveal →" }).click();
    await expect(ceremony.getByText("Grand Champion")).toBeVisible();
    await expect(ceremony.getByRole("heading", { name: /Foxes/ })).toBeVisible();
    await ceremony.close();
  });

  await test.step("grace: results become a public keepsake", async () => {
    await admin.advanceTo("grace");
    const anon = await playwright.request.newContext({ baseURL: WEB_URL });
    const { results } = await (await anon.get(`/api/trips/${tripId}/results`)).json();
    expect(results.find((r: { is_grand_champion: boolean }) => r.is_grand_champion).team_name_vetted).toBe("Foxes");
    await anon.dispose();
  });

  await test.step("erasure: students are signed out and photos are gone; results survive without unreviewed names", async () => {
    await admin.eraseNow();
    const home = new StudentHomePage(kids.Foxes.page);
    await home.goto();
    await home.expectSignedOut();
    expect((await teacher.api.r.get(`/api/submissions/${kids.Foxes.submissionId}/photo`)).status()).toBe(404);
    const results = await teacher.api.results(tripId);
    // Nobody reviewed "Foxes", so only its neutral label survives (#92): Foxes was created first.
    expect(results.filter((r) => r.is_grand_champion).map((r) => r.team_name_vetted)).toEqual(["Team 1"]);
    expect(results.map((r) => r.team_name_vetted)).not.toContain("Foxes");
  });

  await closeAll(teacher, ...Object.values(kids));
});
