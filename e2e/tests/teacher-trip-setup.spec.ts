import { test, expect } from "@playwright/test";
import { signInTeacher, unique, closeAll } from "../support/actors.js";
import { TeacherHomePage, TripAdminPage } from "../pages/teacher.js";

test("signed-out visitors get the PocketID sign-in on the teacher area", async ({ page }) => {
  await page.goto("/teacher");
  await expect(page.getByRole("heading", { name: "Connexion enseignant" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Se connecter avec PocketID" })).toBeVisible();
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

  await test.step("print the QR sheet", async () => {
    const [sheet] = await Promise.all([
      teacher.context.waitForEvent("page"),
      teacher.page.getByRole("link", { name: "Imprimer les QR codes" }).click(),
    ]);
    const card = sheet.getByRole("article").filter({ hasText: "Gelato selfie" });
    await expect(card.getByText("×2 points")).toBeVisible();
    const qr = card.getByRole("img", { name: "QR code du défi Gelato selfie" });
    await expect.poll(() => qr.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await sheet.close();
  });

  await test.step("edit the challenge", async () => {
    const card = admin.card("Défis");
    await admin.challengeRow("Gelato selfie").getByRole("button", { name: "Modifier" }).click();
    await card.getByLabel("Titre").first().fill("Gelato group selfie");
    await card.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(admin.challengeRow("Gelato group selfie")).toBeVisible();
  });

  await test.step("delete a challenge while still in draft", async () => {
    await admin.addChallenge("Tower photo");
    await admin.challengeRow("Tower photo").getByRole("button", { name: "Supprimer" }).click();
    await admin.confirm("Supprimer");
    await expect(admin.challengeRow("Tower photo")).toHaveCount(0);
  });

  await test.step("save settings", async () => {
    await admin.open("Paramètres");
    const settings = admin.card("Paramètres");
    await settings.getByLabel("Nom de la sortie").fill(`${name} (edited)`);
    await settings.getByLabel("Délai de grâce (jours)").fill("3");
    await settings.getByRole("button", { name: "Enregistrer les paramètres" }).click();
    // The confirmation must survive the trip reload that follows a save (#30).
    await expect(settings.getByText("Enregistré.")).toBeVisible();
    await expect(teacher.page.getByRole("heading", { name: `${name} (edited)`, level: 2 })).toBeVisible();
    await expect(settings.getByText("Enregistré.")).toBeVisible();
    expect(await teacher.api.trip(tripId)).toMatchObject({ name: `${name} (edited)`, grace_days: 3 });
  });

  await test.step("plan the phase dates that drive auto-advance (#26)", async () => {
    const settings = admin.card("Paramètres");
    await settings.getByLabel("Ouverture des défis").fill("2030-05-01T09:00");
    await settings.getByLabel("Ouverture du vote").fill("2030-05-03T18:30");
    await settings.getByLabel("Clôture du vote").fill("2030-05-04T12:00");
    await settings.getByRole("button", { name: "Enregistrer les paramètres" }).click();
    await expect(settings.getByText("Enregistré.")).toBeVisible();
    // Paris is UTC+2 in May: local inputs are stored as the right instants.
    expect(await teacher.api.trip(tripId)).toMatchObject({
      challenge_opens_at: "2030-05-01T07:00:00.000Z",
      voting_opens_at: "2030-05-03T16:30:00.000Z",
      voting_closes_at: "2030-05-04T10:00:00.000Z",
    });
    await teacher.page.reload(); // values round-trip back into the form in local time
    await expect(admin.card("Paramètres").getByLabel("Ouverture du vote")).toHaveValue("2030-05-03T18:30");
  });

  await test.step("after the challenge starts: no deleting challenges, team size locked", async () => {
    await admin.advanceTo("challenge");
    await admin.open("Défis");
    await expect(admin.challengeRow("Gelato group selfie").getByRole("button", { name: "Supprimer" })).toHaveCount(0);
    await admin.open("Paramètres");
    await expect(admin.card("Paramètres").getByLabel(/Taille max. d'une équipe/)).toBeDisabled();
  });

  await closeAll(teacher);
});
