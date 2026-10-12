import { test, expect } from "@playwright/test";
import { signInTeacher, uniqueEmail, unique, closeAll } from "../support/actors.js";
import { waitForMail, linkIn, relative } from "../support/mail.js";
import { TripAdminPage } from "../pages/teacher.js";

test("the owner invites a co-teacher by email; only the invited account can accept", async ({ browser }) => {
  const owner = await signInTeacher(browser);
  const name = unique("Rome");
  const tripId = await owner.api.createTrip(name);
  const admin = new TripAdminPage(owner.page);
  const coEmail = uniqueEmail("co");

  await admin.goto(tripId);
  await admin.open("Paramètres");
  const teachers = admin.card("Enseignants");
  await teachers.getByLabel("Inviter un co-enseignant par e-mail").fill(coEmail);
  await teachers.getByRole("button", { name: "Envoyer l'invitation" }).click();
  await expect(teachers.getByText(`Invitation envoyée à ${coEmail}.`)).toBeVisible();

  const mail = await waitForMail(coEmail, { subject: /^Invitation à co-gérer / });
  const acceptPath = relative(linkIn(mail, "/teacher/accept?token="));

  await test.step("a forwarded link opened by someone else is refused", async () => {
    const intruder = await signInTeacher(browser);
    await intruder.page.goto(acceptPath);
    await expect(intruder.page.getByText("Cette invitation a été envoyée à une autre adresse e-mail")).toBeVisible();
    await closeAll(intruder);
  });

  await test.step("the invited teacher accepts and lands on the trip", async () => {
    const co = await signInTeacher(browser, coEmail);
    await co.page.goto(acceptPath);
    await expect(co.page).toHaveURL(new RegExp(`/teacher/trips/${tripId}/overview$`));
    await expect(co.page.getByRole("heading", { name, level: 2 })).toBeVisible();

    const coAdmin = new TripAdminPage(co.page);
    await coAdmin.open("Paramètres");
    await expect(coAdmin.card("Enseignants").getByText(coEmail)).toBeVisible();

    await test.step("co-teachers can't invite others", async () => {
      await coAdmin.card("Enseignants").getByLabel("Inviter un co-enseignant par e-mail").fill(uniqueEmail("x"));
      await coAdmin.card("Enseignants").getByRole("button", { name: "Envoyer l'invitation" }).click();
      await expect(coAdmin.card("Enseignants").getByText("Seul le responsable de la sortie peut inviter des co-enseignants.")).toBeVisible();
    });
    await closeAll(co);
  });

  await closeAll(owner);
});
