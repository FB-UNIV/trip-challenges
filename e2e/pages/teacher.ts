// Page objects for the teacher UI. Locators use roles, labels and visible text (what a
// teacher sees), scoped to the admin's cards by heading, so no test ids are needed.
import { expect, type Locator, type Page } from "@playwright/test";

export class TeacherHomePage {
  constructor(readonly page: Page) {}

  async goto() {
    await this.page.goto("/teacher");
    await expect(this.page.getByRole("heading", { name: "Tes sorties", exact: true })).toBeVisible();
  }

  async createTrip(name: string, endDate = "2030-06-01", maxTeamSize = 4) {
    // The form is open by itself only while the teacher has no trips.
    const nameField = this.page.getByLabel("Nom", { exact: true });
    const open = this.page.getByRole("button", { name: "Nouvelle sortie" });
    await expect(nameField.or(open)).toBeVisible(); // the list has loaded either way
    if (await open.isVisible()) await open.click();
    await this.page.getByLabel("Nom", { exact: true }).fill(name);
    await this.page.getByLabel("Date de fin de la sortie").fill(endDate);
    await this.page.getByLabel("Taille max. d'une équipe").fill(String(maxTeamSize));
    await this.page.getByRole("button", { name: "Créer la sortie" }).click();
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
// The phase pill's label (packages/web/src/ui.tsx PHASE_META).
const PHASE_LABEL = {
  draft: "Brouillon",
  challenge: "Défis",
  voting: "Vote",
  reveal: "Révélation",
  grace: "Délai de grâce",
  erased: "Effacée",
} as const;

const ADVANCE = {
  challenge: "Lancer les défis",
  voting: "Ouvrir le vote",
  reveal: "Fermer le vote et calculer les résultats",
  grace: "Publier les résultats",
} as const;

/** The trip desk: a header (name, phase), a section nav, and the current section's cards. */
export class TripAdminPage {
  constructor(readonly page: Page) {}

  async goto(tripId: string) {
    await this.page.goto(`/teacher/trips/${tripId}`);
    await expect(this.nav()).toBeVisible();
  }

  nav(): Locator {
    return this.page.getByRole("navigation", { name: "Sections de la sortie" });
  }

  /** Switch section via the nav ("Modération" may carry a pending badge: "Modération, 2 en attente"). */
  async open(section: "Vue d'ensemble" | "Défis" | "Élèves" | "Modération" | "Résultats" | "Paramètres") {
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

  async expectPhase(phase: keyof typeof PHASE_LABEL) {
    await expect(this.page.locator(".trip-head .pill")).toHaveText(PHASE_LABEL[phase]);
  }

  /** The overview's Now card moves the trip on, after confirming what that does. */
  async advanceTo(phase: keyof typeof ADVANCE) {
    await this.open("Vue d'ensemble");
    await this.page.getByRole("button", { name: `${ADVANCE[phase]} →` }).click();
    await this.confirm(ADVANCE[phase]);
    await this.expectPhase(phase);
  }

  async addChallenge(title: string, instructions = "", multiplier = 1) {
    await this.open("Défis");
    const card = this.card("Nouveau défi");
    await card.getByLabel("Titre").fill(title);
    await card.getByLabel("Consignes").fill(instructions);
    await card.getByLabel("Multiplicateur").fill(String(multiplier));
    await card.getByRole("button", { name: "Ajouter le défi" }).click();
    await expect(this.challengeRow(title)).toBeVisible();
  }

  challengeRow(title: string): Locator {
    return this.card("Défis").locator(".list-row").filter({ hasText: title });
  }

  /** Answer the in-app confirmation dialog. */
  async confirm(button: string, typeToConfirm?: string) {
    const dialog = this.page.getByRole("alertdialog");
    if (typeToConfirm !== undefined) await dialog.getByLabel(/pour confirmer/).fill(typeToConfirm);
    await dialog.getByRole("button", { name: button, exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }

  async importRoster(emails: string[]) {
    await this.open("Élèves");
    const card = this.card("Liste d'élèves");
    await card.getByLabel(/E-mails des élèves/).fill(emails.join("\n"));
    await card.getByRole("button", { name: "Importer et envoyer les codes" }).click();
    await expect(card.getByText(`${emails.length} sur ${emails.length} en file d'attente.`)).toBeVisible();
  }

  /** Approve every pending nomination (reloads first: the list loads once per visit). */
  async approveAll(expected: number) {
    await this.open("Modération");
    await this.page.reload();
    const queue = this.page.getByRole("region", { name: "En attente de modération" });
    await expect(queue.getByRole("button", { name: "Valider" })).toHaveCount(expected);
    for (let i = expected; i > 0; i--) {
      await queue.getByRole("button", { name: "Valider" }).first().click();
      await expect(queue.getByRole("button", { name: "Valider" })).toHaveCount(i - 1);
    }
    await expect(queue.getByText("Rien à modérer")).toBeVisible();
  }

  /** Erasure lives in Settings' danger zone and asks to type the trip's name. */
  async eraseNow() {
    await this.open("Paramètres");
    const name = await this.page.locator(".trip-head h2").innerText();
    await this.card("Zone de danger").getByRole("button", { name: "Effacer toutes les données des élèves…" }).click();
    await this.confirm("Effacer maintenant", name);
    await this.expectPhase("erased");
  }
}
