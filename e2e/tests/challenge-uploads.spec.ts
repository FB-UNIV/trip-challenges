import { test, expect } from "@playwright/test";
import { signInTeacher, enrollStudents, phoneContext, unique, closeAll } from "../support/actors.js";
import { photo, asFile } from "../support/photos.js";
import { ChallengePage } from "../pages/student.js";

test("a scanned QR shows the challenge; team members upload, photos are cleaned, and one is nominated", async ({ browser }) => {
  const teacher = await signInTeacher(browser);
  const tripId = await teacher.api.createTrip(unique("Rome"));
  const challenge = await teacher.api.addChallenge(tripId, "Best gelato");
  const [ana, ben] = await enrollStudents(browser, teacher, tripId, 2);
  await ana!.api.createTeam("Foxes");
  await ben!.api.createTeam("Owls");
  await teacher.api.advance(tripId, "challenge");

  await test.step("scanning the QR without a session shows the challenge and asks for a code", async () => {
    const stranger = await phoneContext(browser);
    const page = await stranger.newPage();
    await new ChallengePage(page).goto(challenge.qrSlug);
    await expect(page.getByRole("heading", { name: "Best gelato" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Enter your access code to upload" })).toBeVisible();
    await stranger.close();
  });

  const ch = new ChallengePage(ana!.page);
  await test.step("upload two photos and nominate the first one", async () => {
    await ch.goto(challenge.qrSlug);
    await ch.upload(asFile(await photo("#e4572e")));
    await ch.upload(asFile(await photo("#29335c")));
    // Newest first: index 1 is the first upload.
    await ch.nominate(1);
    await ch.page.reload();
    await expect(ch.photos().nth(1).getByRole("button", { name: "Nominated ✓" })).toBeVisible();
  });

  await test.step("photos are JPEG without EXIF, and private to the team during the challenge", async () => {
    const list = await ana!.api.r.get(`/api/submissions?challengeId=${challenge.id}`);
    const [{ id }] = (await list.json()).submissions;
    const own = await ana!.api.r.get(`/api/submissions/${id}/photo`);
    expect(own.status()).toBe(200);
    expect(own.headers()["content-type"]).toBe("image/jpeg");
    expect(own.headers()["cache-control"]).toBe("no-store");
    expect((await own.body()).includes(Buffer.from("E2EPhone"))).toBe(false);

    expect((await ben!.api.r.get(`/api/submissions/${id}/photo`)).status()).toBe(403);
  });

  await closeAll(teacher, ana!, ben!);
});

test("a student without a team plays solo from the QR page, and uploads close when voting starts", async ({ browser }) => {
  const teacher = await signInTeacher(browser);
  const tripId = await teacher.api.createTrip(unique("Rome"));
  const challenge = await teacher.api.addChallenge(tripId, "Best gelato");
  const [ana, loner] = await enrollStudents(browser, teacher, tripId, 2);
  await ana!.api.createTeam("Foxes");
  await teacher.api.advance(tripId, "challenge");

  await test.step("teams are optional (#79): play solo, then upload and nominate like a team", async () => {
    const ch = new ChallengePage(loner!.page);
    await ch.goto(challenge.qrSlug);
    await loner!.page.getByLabel("Your player name").fill("Lone wolf");
    await loner!.page.getByRole("button", { name: "Play solo" }).click();
    await ch.upload(asFile(await photo("#3a7d44")));
    await ch.nominate(0);
  });

  await teacher.api.advance(tripId, "voting");
  await new ChallengePage(ana!.page).goto(challenge.qrSlug);
  await expect(ana!.page.getByText("Uploads are closed (phase: voting).")).toBeVisible();
  await expect(ana!.page.locator('input[type="file"]')).toHaveCount(0);

  await closeAll(teacher, ana!, loner!);
});
