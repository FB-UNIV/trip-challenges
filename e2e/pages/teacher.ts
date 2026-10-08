// Page objects for the teacher UI. Locators use roles, labels and visible text (what a
// teacher sees), scoped to the admin's cards by heading, so no test ids are needed.
import { expect, type Locator, type Page } from "@playwright/test";

export class TeacherHomePage {
  constructor(readonly page: Page) {}

  async goto() {
    await this.page.goto("/teacher");
    await expect(this.page.getByRole("heading", { name: "Trips" })).toBeVisible();
  }

  async createTrip(name: string, endDate = "2030-06-01", maxTeamSize = 4) {
    await this.page.getByLabel("Name", { exact: true }).fill(name);
    await this.page.getByLabel("Trip end date").fill(endDate);
    await this.page.getByLabel("Max team size").fill(String(maxTeamSize));
    await this.page.getByRole("button", { name: "Create trip" }).click();
    await expect(this.tripLink(name)).toBeVisible();
  }

  tripLink(name: string): Locator {
    return this.page.getByRole("link", { name: new RegExp(name) });
  }

  /** Open a trip's admin page (it lands on the overview) and return its id. */
  async openTrip(name: string): Promise<string> {
    await this.tripLink(name).click();
    await expect(this.page).toHaveURL(/\/teacher\/trips\/[0-9a-f-]{36}\/overview$/);
    return this.page.url().split("/").at(-2)!;
  }
}

/** The Now card's action that moves a trip into each phase. */
const ADVANCE = {
  challenge: "Start the challenge",
  voting: "Open voting",
  reveal: "Close voting & compute results",
  grace: "Publish results",
} as const;

/** The trip desk: a header (name, phase), a section nav, and the current section's cards. */
export class TripAdminPage {
  constructor(readonly page: Page) {}

  async goto(tripId: string) {
    await this.page.goto(`/teacher/trips/${tripId}`);
    await expect(this.nav()).toBeVisible();
  }

  nav(): Locator {
    return this.page.getByRole("navigation", { name: "Trip sections" });
  }

  /** Switch section via the nav ("Review" may carry a pending badge: "Review, 2 pending"). */
  async open(section: "Overview" | "Challenges" | "Students" | "Review" | "Results" | "Settings") {
    const link = this.nav().getByRole("link", { name: new RegExp(`^${section}\\b`) });
    await link.click();
    await expect(link).toHaveAttribute("aria-current", "page");
  }

  /** A card in the current section, found by its heading. */
  card(heading: string): Locator {
    return this.page.locator(".card").filter({ has: this.page.getByRole("heading", { name: heading, exact: true }) });
  }

  tile(label: string): Locator {
    return this.page.locator(".tile").filter({ has: this.page.locator(".k", { hasText: label }) }).locator(".v");
  }

  async expectPhase(phase: string) {
    await expect(this.page.locator(".trip-head .pill")).toHaveText(new RegExp(`^${phase}$`, "i"));
  }

  /** The overview's Now card moves the trip on, after confirming what that does. */
  async advanceTo(phase: keyof typeof ADVANCE) {
    await this.open("Overview");
    await this.page.getByRole("button", { name: `${ADVANCE[phase]} →` }).click();
    await this.confirm(ADVANCE[phase]);
    await this.expectPhase(phase);
  }

  async addChallenge(title: string, instructions = "", multiplier = 1) {
    await this.open("Challenges");
    const card = this.card("Challenges");
    await card.getByLabel("Title").fill(title);
    await card.getByLabel("Instructions").fill(instructions);
    await card.getByLabel("Multiplier").fill(String(multiplier));
    await card.getByRole("button", { name: "Add challenge" }).click();
    await expect(this.challengeRow(title)).toBeVisible();
  }

  challengeRow(title: string): Locator {
    return this.card("Challenges").locator(".list-row").filter({ hasText: title });
  }

  /** Answer the in-app confirmation dialog. */
  async confirm(button: string, typeToConfirm?: string) {
    const dialog = this.page.getByRole("alertdialog");
    if (typeToConfirm !== undefined) await dialog.getByLabel(/to confirm/).fill(typeToConfirm);
    await dialog.getByRole("button", { name: button, exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }

  async importRoster(emails: string[]) {
    await this.open("Students");
    const card = this.card("Roster");
    await card.getByLabel(/Student emails/).fill(emails.join("\n"));
    await card.getByRole("button", { name: "Import + email codes" }).click();
    await expect(card.getByText(`Queued ${emails.length} of ${emails.length}.`)).toBeVisible();
  }

  /** Approve every pending nomination (reloads first: the list loads once per visit). */
  async approveAll(expected: number) {
    await this.open("Review");
    await this.page.reload();
    const queue = this.page.getByRole("region", { name: "Waiting for review" });
    await expect(queue.getByRole("button", { name: "Approve" })).toHaveCount(expected);
    for (let i = expected; i > 0; i--) {
      await queue.getByRole("button", { name: "Approve" }).first().click();
      await expect(queue.getByRole("button", { name: "Approve" })).toHaveCount(i - 1);
    }
    await expect(queue.getByText("Nothing to review")).toBeVisible();
  }

  /** Erasure lives in Settings' danger zone and asks to type the trip's name. */
  async eraseNow() {
    await this.open("Settings");
    const name = await this.page.locator(".trip-head h2").innerText();
    await this.card("Danger zone").getByRole("button", { name: "Erase all student data…" }).click();
    await this.confirm("Erase now", name);
    await this.expectPhase("erased");
  }
}
