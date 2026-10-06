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

  /** Open a trip's admin page and return its id. */
  async openTrip(name: string): Promise<string> {
    await this.tripLink(name).click();
    await expect(this.page).toHaveURL(/\/teacher\/trips\/[0-9a-f-]{36}$/);
    return this.page.url().split("/").pop()!;
  }
}

export class TripAdminPage {
  constructor(readonly page: Page) {}

  async goto(tripId: string) {
    await this.page.goto(`/teacher/trips/${tripId}`);
    await expect(this.card("Lifecycle")).toBeVisible();
  }

  /** An admin card, found by its heading. */
  card(heading: string): Locator {
    return this.page.locator(".card").filter({ has: this.page.getByRole("heading", { name: heading, exact: true }) });
  }

  tile(label: string): Locator {
    return this.page.locator(".tile").filter({ has: this.page.locator(".k", { hasText: label }) }).locator(".v");
  }

  async expectPhase(phase: string) {
    await expect(this.tile("Phase")).toHaveText(phase);
  }

  async advanceTo(phase: string) {
    await this.card("Lifecycle").getByRole("button", { name: `Advance to ${phase} →` }).click();
    await this.expectPhase(phase);
  }

  async addChallenge(title: string, instructions = "", multiplier = 1) {
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

  async importRoster(emails: string[]) {
    const card = this.card("Roster");
    await card.locator("textarea").fill(emails.join("\n"));
    await card.getByRole("button", { name: "Import + email codes" }).click();
    await expect(card.getByText(`Queued ${emails.length} of ${emails.length}.`)).toBeVisible();
  }

  /** Approve every pending nomination (reloads first: the list loads once per visit). */
  async approveAll(expected: number) {
    await this.page.reload();
    const card = this.card("Moderation");
    await expect(card.getByRole("button", { name: "Approve" })).toHaveCount(expected);
    for (let i = expected; i > 0; i--) {
      await card.getByRole("button", { name: "Approve" }).first().click();
      await expect(card.getByRole("button", { name: "Approve" })).toHaveCount(i - 1);
    }
    await expect(card.getByText("Nothing to review.")).toBeVisible();
  }

  /** "Erase now" asks for confirmation with a native dialog. */
  async eraseNow() {
    this.page.once("dialog", (d) => void d.accept());
    await this.card("Lifecycle").getByRole("button", { name: "Erase now" }).click();
    await this.expectPhase("erased");
  }
}
