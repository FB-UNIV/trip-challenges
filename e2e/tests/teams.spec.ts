import { test, expect } from "@playwright/test";
import { signInTeacher, enrollStudents, unique, closeAll } from "../support/actors.js";
import { TeamPage, StudentHomePage } from "../pages/student.js";

test("students form teams up to the size limit, can switch, and teams lock when the challenge starts", async ({ browser }) => {
  const teacher = await signInTeacher(browser);
  const name = unique("Rome");
  const tripId = await teacher.api.createTrip(name, { maxTeamSize: 2 });
  const [ana, ben, cleo] = await enrollStudents(browser, teacher, tripId, 3);
  const [a, b, c] = [new TeamPage(ana!.page), new TeamPage(ben!.page), new TeamPage(cleo!.page)];

  await test.step("create and join", async () => {
    await a.goto();
    await a.create("Foxes");
    await b.goto();
    await expect(b.row("Foxes")).toContainText("1 member");
    await b.join("Foxes");
    await expect(ben!.page.getByText("You're all set.")).toBeVisible();
  });

  await test.step("a full team refuses a third member", async () => {
    await c.goto();
    await expect(c.row("Foxes")).toContainText("2 members");
    await c.join("Foxes");
    await expect(cleo!.page.locator(".err")).toContainText("full");
  });

  await test.step("switch teams before the lock", async () => {
    await c.create("Owls");
    await b.leave();
    await b.join("Owls");
    await expect(ben!.page.getByText("You're all set.")).toBeVisible();
  });

  await test.step("teams lock once the challenge period starts", async () => {
    await teacher.api.advance(tripId, "challenge");
    await a.goto();
    await expect(ana!.page.getByRole("heading", { name: "Teams are locked" })).toBeVisible();
    const home = new StudentHomePage(ana!.page);
    await home.goto();
    await expect(ana!.page.getByRole("heading", { name: "Foxes" })).toBeVisible();
  });

  await closeAll(teacher, ana!, ben!, cleo!);
});
