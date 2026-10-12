// The student's challenge checklist (/challenges): what's left to snap, what's entered.
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "./server.js";
import { renderAt } from "./render.js";

const ME = { studentId: "s1", tripId: "t1", tripName: "Rome 2030", phase: "challenge", teamId: "team1" };
const ch = (id: string, title: string, photos: number, nominated: boolean, entry: string | null = nominated ? "pending" : null) => ({
  id, title, instructions: "", qrSlug: `slug-${id}`, photos, nominated, entry, vote: null,
});
const meIs = (me: object) => http.get("/api/student/me", () => HttpResponse.json(me));
const listIs = (challenges: object[]) => http.get("/api/challenges/for-student", () => HttpResponse.json({ challenges }));
const titlesInOrder = (container: HTMLElement) =>
  [...container.querySelectorAll(".check-row b")].map((b) => b.textContent);

const THREE = [ch("c1", "Statue selfie", 1, true), ch("c2", "Gelato", 2, false), ch("c3", "Pyramid", 0, false)];

describe("challenge checklist", () => {
  it("lists what's left first, each opening the same page as its QR code", async () => {
    server.use(meIs(ME), listIs(THREE));
    const { container } = renderAt("/challenges");

    expect(await screen.findByRole("link", { name: /Pyramid/ })).toHaveAttribute("href", "/c/slug-c3");
    expect(titlesInOrder(container)).toEqual(["Gelato", "Pyramid", "Statue selfie"]);
    expect(screen.getByRole("link", { name: /Gelato/ })).toHaveTextContent("2 photos · choisis-en une");
    expect(screen.getByRole("link", { name: /Gelato/ })).toContainElement(screen.getByLabelText("En cours"));
    expect(screen.getByRole("link", { name: /Pyramid/ })).toHaveTextContent("Pas encore de photo");
    expect(screen.getByRole("link", { name: /Statue selfie/ })).toHaveTextContent("En lice");
    expect(screen.getByRole("link", { name: /Statue selfie/ })).toHaveAttribute("href", "/c/slug-c1");
  });

  // #81: the team sees where each entry stands, and a rejected one is back on the to-do list.
  it("shows each entry's state; a rejected entry is a to-do again", async () => {
    server.use(meIs(ME), listIs([
      ch("c1", "Statue selfie", 1, true, "approved"),
      ch("c2", "Gelato", 2, true, "pending"),
      ch("c3", "Pyramid", 2, false, "rejected"),
    ]));
    const { container } = renderAt("/challenges");
    expect(await screen.findByRole("link", { name: /Pyramid/ })).toHaveTextContent("Refusée · choisis une autre photo");
    expect(screen.getByRole("link", { name: /Pyramid/ })).toContainElement(screen.getByLabelText("En cours"));
    expect(screen.getByRole("link", { name: /Gelato/ })).toHaveTextContent("En attente de ton enseignant");
    expect(screen.getByRole("link", { name: /Statue selfie/ })).toHaveTextContent("Validée");
    expect(titlesInOrder(container)[0]).toBe("Pyramid");
    expect(screen.getByRole("link", { name: "Défis, 1 à faire" })).toBeInTheDocument();
  });

  it("after photo time, a rejected entry just says so", async () => {
    server.use(meIs({ ...ME, phase: "voting" }), listIs([ch("c3", "Pyramid", 2, false, "rejected")]));
    renderAt("/challenges");
    expect(await screen.findByText("Refusée")).toBeInTheDocument();
    expect(screen.queryByText(/choisis une autre/)).not.toBeInTheDocument();
  });

  it("shows overall progress as challenges entered", async () => {
    server.use(meIs(ME), listIs(THREE));
    renderAt("/challenges");
    const bar = await screen.findByRole("progressbar", { name: "Défis en lice" });
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "3");
  });

  it("says “1 photo” for a single photo", async () => {
    server.use(meIs(ME), listIs([ch("c2", "Gelato", 1, false)]));
    renderAt("/challenges");
    expect(await screen.findByRole("link", { name: /Gelato/ })).toHaveTextContent("1 photo · choisis-en une");
  });

  it("celebrates when every challenge is entered", async () => {
    server.use(meIs(ME), listIs([ch("c1", "Statue selfie", 1, true)]));
    renderAt("/challenges");
    expect(await screen.findByText("Tout est en lice !")).toBeInTheDocument();
  });

  it("previews the challenges, locked, before the trip starts", async () => {
    server.use(meIs({ ...ME, phase: "draft" }), listIs(THREE));
    renderAt("/challenges");
    expect(await screen.findByText("Se débloque au départ de la sortie")).toBeInTheDocument();
    expect(screen.getByText("Pyramid")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Pyramid/ })).not.toBeInTheDocument();
  });

  it("points to voting once photo time is over", async () => {
    server.use(meIs({ ...ME, phase: "voting" }), listIs(THREE));
    renderAt("/challenges");
    expect(await screen.findByText("Le temps des photos est fini")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Aller voter/ })).toHaveAttribute("href", "/vote");
    expect(screen.queryByRole("link", { name: /Pyramid/ })).not.toBeInTheDocument();
  });

  it("doesn't offer voting after it has ended", async () => {
    server.use(meIs({ ...ME, phase: "reveal" }), listIs(THREE));
    renderAt("/challenges");
    expect(await screen.findByText("Le temps des photos est fini")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Aller voter/ })).not.toBeInTheDocument();
  });

  it("offers a student without a team to play solo right here (#79)", async () => {
    server.use(meIs({ ...ME, teamId: null }), listIs(THREE));
    renderAt("/challenges");
    expect(await screen.findByRole("heading", { name: "Jouer en solo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jouer en solo" })).toBeDisabled(); // until named
  });

  it("shows an empty state when the trip has no challenges", async () => {
    server.use(meIs(ME), listIs([]));
    renderAt("/challenges");
    expect(await screen.findByText("Pas encore de défi")).toBeInTheDocument();
  });

  it("shows a loading placeholder, then a retry on failure", async () => {
    let fail = true;
    server.use(meIs(ME), http.get("/api/challenges/for-student", () =>
      fail ? HttpResponse.json({ error: "boom" }, { status: 500 }) : HttpResponse.json({ challenges: THREE })));
    const { user } = renderAt("/challenges");
    expect(screen.getByRole("status", { name: "Chargement" })).toBeInTheDocument();
    const retry = await screen.findByRole("button", { name: "Réessayer" });
    fail = false;
    await user.click(retry);
    expect(await screen.findByRole("link", { name: /Pyramid/ })).toBeInTheDocument();
  });
});
