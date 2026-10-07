// The student bottom tab bar (app shell): where am I, and where is there something to do.
import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "./server.js";
import { renderAt } from "./render.js";

const ME = { studentId: "s1", tripId: "t1", tripName: "Rome 2030", phase: "challenge", teamId: "team1" };
type Vote = { voted: number; total: number; status: "todo" | "in_progress" | "done" | "not_enough" } | null;
const ch = (id: string, nominated: boolean, vote: Vote = null) => ({
  id, title: `Challenge ${id}`, instructions: "", qrSlug: `slug-${id}`, photos: nominated ? 1 : 0, nominated, vote,
});
const meIs = (me: object) => http.get("/api/student/me", () => HttpResponse.json(me));
const listIs = (challenges: object[]) => http.get("/api/challenges/for-student", () => HttpResponse.json({ challenges }));
const teams = () => http.get("/api/teams", () => HttpResponse.json({ teams: [] }));
const tabBar = () => screen.findByRole("navigation", { name: "Main" });

describe("student tab bar", () => {
  it("challenge phase: badges the challenges not yet entered; Vote is locked", async () => {
    server.use(meIs(ME), listIs([ch("c1", true), ch("c2", false), ch("c3", false)]));
    renderAt("/challenges");
    const nav = await tabBar();
    expect(await within(nav).findByRole("link", { name: "Challenges, 2 to do" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: "Team" })).toHaveAttribute("href", "/team");
    expect(within(nav).queryByRole("link", { name: /Vote/ })).not.toBeInTheDocument();
    expect(within(nav).getByText("Vote").closest("[aria-disabled]")).toHaveAttribute("aria-disabled", "true");
  });

  it("draft without a team: the Team tab carries the badge", async () => {
    server.use(meIs({ ...ME, phase: "draft", teamId: null }), listIs([ch("c1", false)]), teams());
    renderAt("/team");
    const nav = await tabBar();
    expect(await within(nav).findByRole("link", { name: "Team, 1 to do" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Challenges" })).toBeInTheDocument();
  });

  it("voting: badges the challenges with duels left, and Vote is open", async () => {
    server.use(meIs({ ...ME, phase: "voting" }), listIs([
      ch("c1", true, { voted: 0, total: 3, status: "todo" }),
      ch("c2", true, { voted: 1, total: 3, status: "in_progress" }),
      ch("c3", true, { voted: 1, total: 1, status: "done" }),
      ch("c4", true, { voted: 0, total: 0, status: "not_enough" }),
    ]));
    renderAt("/vote");
    const nav = await tabBar();
    expect(await within(nav).findByRole("link", { name: "Vote, 2 to do" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Challenges" })).toBeInTheDocument();
  });

  it("lights up Challenges on a scanned challenge page", async () => {
    server.use(
      meIs(ME), listIs([ch("c1", true)]),
      http.get("/api/challenges/by-slug/abc", () => HttpResponse.json({ id: "c1", title: "Gelato", instructions: "" })),
      http.get("/api/submissions", () => HttpResponse.json({ submissions: [] })),
    );
    renderAt("/c/abc");
    const nav = await tabBar();
    expect(await within(nav).findByRole("link", { name: "Challenges" })).toHaveAttribute("aria-current", "page");
  });

  it("switches screens", async () => {
    server.use(meIs({ ...ME, phase: "voting" }), listIs([]));
    const { user, location } = renderAt("/vote");
    await user.click(within(await tabBar()).getByRole("link", { name: "Challenges" }));
    expect(location()).toBe("/challenges");
  });

  it("still works without badges if the challenge list fails", async () => {
    server.use(meIs(ME), http.get("/api/challenges/for-student", () => HttpResponse.json({}, { status: 500 })));
    renderAt("/vote");
    const nav = await tabBar();
    expect(within(nav).getByRole("link", { name: "Challenges" })).toBeInTheDocument();
  });

  it("isn't shown to a signed-out visitor", async () => {
    server.use(http.get("/api/student/me", () => HttpResponse.json({}, { status: 401 })));
    renderAt("/");
    expect(await screen.findByText("Enter your access code")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  });

  it("isn't shown on teacher pages, and doesn't ask who the student is there", async () => {
    let askedStudent = false;
    server.use(
      http.get("/api/student/me", () => { askedStudent = true; return HttpResponse.json(ME); }),
      http.get("/api/auth/teacher/me", () => HttpResponse.json({}, { status: 401 })),
      http.get("/api/trips", () => HttpResponse.json({}, { status: 401 })),
    );
    renderAt("/teacher");
    expect(await screen.findByRole("link", { name: /Teacher/ })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
    expect(askedStudent).toBe(false);
  });
});
