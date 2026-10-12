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
    await expect(this.page.getByRole("heading", { name: "Saisis ton code d'accès" })).toBeVisible();
  }

  async enterCode(code: string) {
    await this.page.getByLabel("Code d'accès").fill(code);
    await this.page.getByRole("button", { name: "Continuer" }).click();
  }
}

export class TeamPage {
  constructor(readonly page: Page) {}

  async goto() {
    await this.page.goto("/team");
  }

  async create(name: string) {
    await this.page.getByLabel("Nom de la nouvelle équipe").fill(name);
    await this.page.getByRole("button", { name: "Créer l'équipe" }).click();
    await this.expectInTeam();
  }

  /** The in-team view: my team's next steps. */
  async expectInTeam() {
    await expect(this.page.getByRole("list", { name: "Prochaines étapes" })).toBeVisible();
  }

  row(name: string): Locator {
    return this.page.locator(".list-row").filter({ hasText: name });
  }

  async join(name: string) {
    await this.row(name).getByRole("button", { name: "Rejoindre" }).click();
  }

  async leave() {
    await this.page.getByRole("button", { name: "Quitter l'équipe" }).click();
    await expect(this.page.getByLabel("Nom de la nouvelle équipe")).toBeVisible();
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
    await this.page.getByRole("button", { name: "Envoyer" }).click();
    await expect(this.photos()).toHaveCount(before + 1);
  }

  async nominate(index = 0) {
    await this.photos().nth(index).getByRole("button", { name: "Sélectionner" }).click();
    await expect(this.photos().nth(index).getByRole("button", { name: "Sélectionnée ✓" })).toBeVisible();
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
    await expect(this.page.getByRole("heading", { name: "Laquelle est la meilleure ?" })).toBeVisible();
    // In dev, React StrictMode runs the page's load effect twice, so a second pair can
    // re-render the sides (possibly swapped) right as we click. Wait until it settles.
    await this.page.waitForLoadState("networkidle");
    await this.option(submissionId).click();
  }

  /** This challenge has no pairs left: "Challenge done!" (more to vote) or "All voted!" (last one). */
  async expectAllJudged() {
    await expect(this.page.getByRole("heading", { name: /^(Défi terminé !|Tout est voté !)$/ })).toBeVisible();
  }
}
