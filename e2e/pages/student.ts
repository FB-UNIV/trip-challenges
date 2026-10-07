// Page objects for the student PWA (used on phone-sized contexts).
import { expect, type Locator, type Page } from "@playwright/test";

export class StudentHomePage {
  constructor(readonly page: Page) {}

  async goto() {
    await this.page.goto("/");
  }

  async expectSignedIn(tripName: string) {
    await expect(this.page.getByText(tripName, { exact: true })).toBeVisible();
  }

  async expectSignedOut() {
    await expect(this.page.getByRole("heading", { name: "Enter your access code" })).toBeVisible();
  }

  async enterCode(code: string) {
    await this.page.getByLabel("Access code").fill(code);
    await this.page.getByRole("button", { name: "Continue" }).click();
  }
}

export class TeamPage {
  constructor(readonly page: Page) {}

  async goto() {
    await this.page.goto("/team");
  }

  async create(name: string) {
    await this.page.getByLabel("New team name").fill(name);
    await this.page.getByRole("button", { name: "Create team" }).click();
    await expect(this.page.getByText("You're all set.")).toBeVisible();
  }

  row(name: string): Locator {
    return this.page.locator(".list-row").filter({ hasText: name });
  }

  async join(name: string) {
    await this.row(name).getByRole("button", { name: "Join" }).click();
  }

  async leave() {
    await this.page.getByRole("button", { name: "Leave team" }).click();
    await expect(this.page.getByLabel("New team name")).toBeVisible();
  }
}

export class ChallengePage {
  constructor(readonly page: Page) {}

  async goto(qrSlug: string) {
    await this.page.goto(`/c/${qrSlug}`);
  }

  photos(): Locator {
    return this.page.locator(".photo-cell");
  }

  async upload(file: { name: string; mimeType: string; buffer: Buffer }) {
    const before = await this.photos().count();
    await this.page.locator('input[type="file"]').setInputFiles(file);
    await this.page.getByRole("button", { name: "Upload" }).click();
    await expect(this.photos()).toHaveCount(before + 1);
  }

  async nominate(index = 0) {
    await this.photos().nth(index).getByRole("button", { name: "Nominate" }).click();
    await expect(this.photos().nth(index).getByRole("button", { name: "Nominated ✓" })).toBeVisible();
  }
}

export class VotePage {
  constructor(readonly page: Page) {}

  async goto(challengeId: string) {
    await this.page.goto(`/vote/${challengeId}`);
  }

  /** The duel option showing a given submission's photo. */
  option(submissionId: string): Locator {
    return this.page.locator("button.pick").filter({ has: this.page.locator(`img[src*="${submissionId}"]`) });
  }

  async pick(submissionId: string) {
    await expect(this.page.getByRole("heading", { name: "Which is better?" })).toBeVisible();
    // In dev, React StrictMode runs the page's load effect twice, so a second pair can
    // re-render the sides (possibly swapped) right as we click. Wait until it settles.
    await this.page.waitForLoadState("networkidle");
    await this.option(submissionId).click();
  }

  /** This challenge has no pairs left: "Challenge done!" (more to vote) or "All voted!" (last one). */
  async expectAllJudged() {
    await expect(this.page.getByRole("heading", { name: /^(Challenge done!|All voted!)$/ })).toBeVisible();
  }
}
