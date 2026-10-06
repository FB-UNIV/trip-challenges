import { test, expect } from "@playwright/test";
import { signInTeacher, unique, closeAll } from "../support/actors.js";
import { TeacherHomePage, TripAdminPage } from "../pages/teacher.js";

test("signed-out visitors get the PocketID sign-in on the teacher area", async ({ page }) => {
  await page.goto("/teacher");
  await expect(page.getByRole("heading", { name: "Teacher sign-in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with PocketID" })).toBeVisible();
});

test("a teacher creates a trip, manages challenges and settings, and edits lock as phases advance", async ({ browser }) => {
  const teacher = await signInTeacher(browser);
  const home = new TeacherHomePage(teacher.page);
  const admin = new TripAdminPage(teacher.page);
  const name = unique("Rome");

  await test.step("create the trip", async () => {
    await home.goto();
    await home.createTrip(name, "2030-06-01", 3);
  });
  const tripId = await home.openTrip(name);
  await admin.expectPhase("draft");

  await test.step("add a challenge with a printable QR", async () => {
    await admin.addChallenge("Gelato selfie", "Find the best gelato in town", 2);
    const row = admin.challengeRow("Gelato selfie");
    await expect(row.getByText("×2")).toBeVisible();
    const qr = row.getByRole("img", { name: "QR" });
    await expect.poll(() => qr.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  });

  await test.step("edit the challenge", async () => {
    const card = admin.card("Challenges");
    await admin.challengeRow("Gelato selfie").getByRole("button", { name: "Edit" }).click();
    await card.getByLabel("Title").first().fill("Gelato group selfie");
    await card.getByRole("button", { name: "Save", exact: true }).click();
    await expect(admin.challengeRow("Gelato group selfie")).toBeVisible();
  });

  await test.step("delete a challenge while still in draft", async () => {
    await admin.addChallenge("Tower photo");
    teacher.page.once("dialog", (d) => void d.accept());
    await admin.challengeRow("Tower photo").getByRole("button", { name: "Delete" }).click();
    await expect(admin.challengeRow("Tower photo")).toHaveCount(0);
  });

  await test.step("save settings", async () => {
    const settings = admin.card("Settings");
    await settings.getByLabel("Trip name").fill(`${name} (edited)`);
    await settings.getByLabel("Grace days").fill("3");
    await settings.getByRole("button", { name: "Save settings" }).click();
    // The confirmation must survive the trip reload that follows a save (#30).
    await expect(settings.getByText("Saved.")).toBeVisible();
    await expect(teacher.page.getByRole("heading", { name: `${name} (edited)`, level: 2 })).toBeVisible();
    await expect(settings.getByText("Saved.")).toBeVisible();
    expect(await teacher.api.trip(tripId)).toMatchObject({ name: `${name} (edited)`, grace_days: 3 });
  });

  await test.step("after the challenge starts: no deleting challenges, team size locked", async () => {
    await admin.advanceTo("challenge");
    await expect(admin.challengeRow("Gelato group selfie").getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(admin.card("Settings").getByLabel(/Max team size/)).toBeDisabled();
  });

  await closeAll(teacher);
});
