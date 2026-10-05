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
  const teachers = admin.card("Teachers");
  await teachers.getByLabel("Invite co-teacher by email").fill(coEmail);
  await teachers.getByRole("button", { name: "Send invite" }).click();
  await expect(teachers.getByText(`Invite emailed to ${coEmail}.`)).toBeVisible();

  const mail = await waitForMail(coEmail, { subject: /^You've been invited to co-manage / });
  const acceptPath = relative(linkIn(mail, "/teacher/accept?token="));

  await test.step("a forwarded link opened by someone else is refused", async () => {
    const intruder = await signInTeacher(browser);
    await intruder.page.goto(acceptPath);
    await expect(intruder.page.getByText("This invite was sent to a different email address")).toBeVisible();
    await closeAll(intruder);
  });

  await test.step("the invited teacher accepts and lands on the trip", async () => {
    const co = await signInTeacher(browser, coEmail);
    await co.page.goto(acceptPath);
    await expect(co.page).toHaveURL(new RegExp(`/teacher/trips/${tripId}$`));
    await expect(co.page.getByRole("heading", { name, level: 2 })).toBeVisible();

    const coAdmin = new TripAdminPage(co.page);
    await expect(coAdmin.card("Teachers").getByText(coEmail)).toBeVisible();

    await test.step("co-teachers can't invite others", async () => {
      await coAdmin.card("Teachers").getByLabel("Invite co-teacher by email").fill(uniqueEmail("x"));
      await coAdmin.card("Teachers").getByRole("button", { name: "Send invite" }).click();
      await expect(coAdmin.card("Teachers").getByText("Only the trip owner can invite co-teachers.")).toBeVisible();
    });
    await closeAll(co);
  });

  await closeAll(owner);
});
