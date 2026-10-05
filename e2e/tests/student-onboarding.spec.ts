import { test, expect } from "@playwright/test";
import {
  signInTeacher, joinByEmail, joinLinkFor, phoneContext, uniqueEmail, unique, closeAll, ACCESS_CODE_SUBJECT,
} from "../support/actors.js";
import { waitForMails, waitForMail, linkIn, relative, mailCount } from "../support/mail.js";
import { TripAdminPage } from "../pages/teacher.js";
import { StudentHomePage } from "../pages/student.js";

test("the teacher imports a roster and each student joins from their emailed link", async ({ browser }) => {
  const teacher = await signInTeacher(browser);
  const name = unique("Rome");
  const tripId = await teacher.api.createTrip(name);
  const admin = new TripAdminPage(teacher.page);
  const emails = [uniqueEmail("kid"), uniqueEmail("kid")];

  await admin.goto(tripId);
  await admin.importRoster(emails);
  // The roster card polls the background worker until every code is emailed.
  await expect(admin.card("Roster").getByText("2 students · 0 queued · 2 emailed")).toBeVisible({ timeout: 30_000 });

  const mail = await waitForMail(emails[0]!, { subject: ACCESS_CODE_SUBJECT });
  expect(mail.subject).toBe(`Your access code for ${name}`);
  expect(mail.text).toContain("This link is personal");

  const kid = await joinByEmail(browser, emails[0]!);
  const home = new StudentHomePage(kid.page);
  await home.expectSignedIn(name);
  await expect(kid.page.getByRole("heading", { name: "No team yet" })).toBeVisible();
  await expect(kid.page.getByRole("button", { name: "Go to teams" })).toBeVisible();

  await closeAll(teacher, kid);
});

test("an access-code link works once; used and bogus codes are refused", async ({ browser }) => {
  const teacher = await signInTeacher(browser);
  const tripId = await teacher.api.createTrip(unique("Rome"));
  const email = uniqueEmail("kid");
  await teacher.api.importRoster(tripId, [email]);
  const link = await joinLinkFor(email);

  const first = await phoneContext(browser);
  const p1 = await first.newPage();
  await p1.goto(link);
  await expect(p1).toHaveURL(/\/$/);

  const second = await phoneContext(browser);
  const p2 = await second.newPage();
  await p2.goto(link);
  await expect(p2.getByText("This link is invalid or has already been used.")).toBeVisible();

  const home = new StudentHomePage(p2);
  await home.goto();
  await home.expectSignedOut();
  await home.enterCode("BOGUS-CODE-123456");
  await expect(p2.getByText("That code is invalid or has already been used.")).toBeVisible();

  await Promise.all([first.close(), second.close(), teacher.context.close()]);
});

test("a student who lost their phone gets a fresh code, and using it signs the old phone out", async ({ browser }) => {
  const teacher = await signInTeacher(browser);
  const name = unique("Rome");
  const tripId = await teacher.api.createTrip(name);
  const email = uniqueEmail("kid");
  await teacher.api.importRoster(tripId, [email]);
  const oldPhone = await joinByEmail(browser, email);

  const newPhone = await phoneContext(browser);
  const page = await newPhone.newPage();
  await page.goto(`/join?trip=${tripId}`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send me a new code" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();

  const mails = await waitForMails(email, { subject: ACCESS_CODE_SUBJECT, count: 2 });
  const freshLink = relative(linkIn(mails[1]!, "/join?code="));

  // Requesting alone doesn't log anyone out.
  const oldHome = new StudentHomePage(oldPhone.page);
  await oldHome.goto();
  await oldHome.expectSignedIn(name);

  await page.goto(freshLink);
  await new StudentHomePage(page).expectSignedIn(name);

  await oldPhone.page.reload();
  await oldHome.expectSignedOut();

  await Promise.all([newPhone.close(), oldPhone.context.close(), teacher.context.close()]);
});

test("the lost-code form never reveals whether an email is on the roster", async ({ browser }) => {
  const teacher = await signInTeacher(browser);
  const tripId = await teacher.api.createTrip(unique("Rome"));
  const known = uniqueEmail("kid");
  const stranger = uniqueEmail("stranger");
  await teacher.api.importRoster(tripId, [known]);
  await waitForMail(known, { subject: ACCESS_CODE_SUBJECT });

  const phone = await phoneContext(browser);
  const page = await phone.newPage();
  for (const email of [stranger, known]) {
    await page.goto(`/join?trip=${tripId}`);
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send me a new code" }).click();
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  }
  // The known student got a second code; the stranger got nothing.
  await waitForMails(known, { subject: ACCESS_CODE_SUBJECT, count: 2 });
  expect(await mailCount(stranger)).toBe(0);

  await Promise.all([phone.close(), teacher.context.close()]);
});
