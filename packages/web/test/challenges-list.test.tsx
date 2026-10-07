// The student's challenge checklist (/challenges): what's left to snap, what's entered.
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "./server.js";
import { renderAt } from "./render.js";

const ME = { studentId: "s1", tripId: "t1", tripName: "Rome 2030", phase: "challenge", teamId: "team1" };
const ch = (id: string, title: string, photos: number, nominated: boolean) => ({
  id, title, instructions: "", qrSlug: `slug-${id}`, photos, nominated, vote: null,
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
    expect(screen.getByRole("link", { name: /Gelato/ })).toHaveTextContent("2 photos · pick one");
    expect(screen.getByRole("link", { name: /Gelato/ })).toContainElement(screen.getByLabelText("In progress"));
    expect(screen.getByRole("link", { name: /Pyramid/ })).toHaveTextContent("No photo yet");
    expect(screen.getByRole("link", { name: /Statue selfie/ })).toHaveTextContent("Entered");
    expect(screen.getByRole("link", { name: /Statue selfie/ })).toHaveAttribute("href", "/c/slug-c1");
  });

  it("shows overall progress as challenges entered", async () => {
    server.use(meIs(ME), listIs(THREE));
    renderAt("/challenges");
    const bar = await screen.findByRole("progressbar", { name: "Challenges entered" });
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "3");
  });

  it("says “1 photo” for a single photo", async () => {
    server.use(meIs(ME), listIs([ch("c2", "Gelato", 1, false)]));
    renderAt("/challenges");
    expect(await screen.findByRole("link", { name: /Gelato/ })).toHaveTextContent("1 photo · pick one");
  });

  it("celebrates when every challenge is entered", async () => {
    server.use(meIs(ME), listIs([ch("c1", "Statue selfie", 1, true)]));
    renderAt("/challenges");
    expect(await screen.findByText("All entered!")).toBeInTheDocument();
  });

  it("previews the challenges, locked, before the trip starts", async () => {
    server.use(meIs({ ...ME, phase: "draft" }), listIs(THREE));
    renderAt("/challenges");
    expect(await screen.findByText("Unlocks when the trip starts")).toBeInTheDocument();
    expect(screen.getByText("Pyramid")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Pyramid/ })).not.toBeInTheDocument();
  });

  it("points to voting once photo time is over", async () => {
    server.use(meIs({ ...ME, phase: "voting" }), listIs(THREE));
    renderAt("/challenges");
    expect(await screen.findByText("Photo time's over")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Go vote/ })).toHaveAttribute("href", "/vote");
    expect(screen.queryByRole("link", { name: /Pyramid/ })).not.toBeInTheDocument();
  });

  it("doesn't offer voting after it has ended", async () => {
    server.use(meIs({ ...ME, phase: "reveal" }), listIs(THREE));
    renderAt("/challenges");
    expect(await screen.findByText("Photo time's over")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Go vote/ })).not.toBeInTheDocument();
  });

  it("sends a student without a team to the teams page", async () => {
    server.use(meIs({ ...ME, teamId: null }), listIs(THREE));
    renderAt("/challenges");
    expect(await screen.findByText("No team yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Go to teams/ })).toHaveAttribute("href", "/team");
  });

  it("shows an empty state when the trip has no challenges", async () => {
    server.use(meIs(ME), listIs([]));
    renderAt("/challenges");
    expect(await screen.findByText("No challenges yet")).toBeInTheDocument();
  });

  it("shows a loading placeholder, then a retry on failure", async () => {
    let fail = true;
    server.use(meIs(ME), http.get("/api/challenges/for-student", () =>
      fail ? HttpResponse.json({ error: "boom" }, { status: 500 }) : HttpResponse.json({ challenges: THREE })));
    const { user } = renderAt("/challenges");
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    fail = false;
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: /Pyramid/ })).toBeInTheDocument();
  });
});
