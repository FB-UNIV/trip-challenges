// "Instant" data: screens share one cache, refresh when the app comes back to the
// foreground, poll gently while open, and an action refreshes everything it changes.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, screen, within } from "@testing-library/react";
import { focusManager } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "./server.js";
import { renderAt } from "./render.js";
import { LIVE_MS } from "../src/query.js";

const ME = { studentId: "s1", tripId: "t1", tripName: "Rome 2030", phase: "challenge", teamId: "team1" };
const ch = (id: string, nominated: boolean) => ({
  id, title: `Challenge ${id}`, instructions: "", qrSlug: `slug-${id}`, photos: nominated ? 1 : 0, nominated, vote: null,
});
const tabBar = () => screen.findByRole("navigation", { name: "Main" });

/** Fake student API with request counters and mutable state. */
function studentApi(over: Partial<Omit<typeof ME, "teamId"> & { teamId: string | null }> = {}) {
  const s = { me: { ...ME, ...over } as Omit<typeof ME, "teamId"> & { teamId: string | null }, calls: { me: 0, challenges: 0, teams: 0 },
    teams: [] as { id: string; name: string; members: number }[] };
  server.use(
    http.get("/api/student/me", () => { s.calls.me++; return HttpResponse.json(s.me); }),
    http.get("/api/challenges/for-student", () => { s.calls.challenges++; return HttpResponse.json({ challenges: [ch("c1", false)] }); }),
    http.get("/api/teams", () => { s.calls.teams++; return HttpResponse.json({ teams: s.teams }); }),
    http.post("/api/teams", async ({ request }) => {
      const { name } = (await request.json()) as { name: string };
      s.teams.push({ id: "team9", name, members: 1 });
      s.me = { ...s.me, teamId: "team9" };
      return HttpResponse.json({ teamId: "team9" }, { status: 201 });
    }),
  );
  return s;
}

afterEach(() => { vi.useRealTimers(); });

describe("live data (student)", () => {
  it("asks who's signed in once per screen, though the tab bar needs it too", async () => {
    const api = studentApi();
    renderAt("/challenges");
    await within(await tabBar()).findByRole("link", { name: "Challenges, 1 to do" });
    await screen.findByText("Challenge c1");
    expect(api.calls.me).toBe(1);
    expect(api.calls.challenges).toBe(1);
  });

  it("joining a team clears the Team badge without a reload", async () => {
    studentApi({ phase: "draft", teamId: null });
    const { user } = renderAt("/team");
    const nav = await tabBar();
    expect(await within(nav).findByRole("link", { name: "Team, 1 to do" })).toBeInTheDocument();
    await user.type(await screen.findByLabelText("New team name"), "Foxes");
    await user.click(screen.getByRole("button", { name: "Create team" }));
    expect(await within(nav).findByRole("link", { name: "Team" })).toBeInTheDocument();
  });

  it("coming back to the app picks up what changed meanwhile (the teacher opened voting)", async () => {
    const api = studentApi();
    renderAt("/challenges");
    const nav = await tabBar();
    await within(nav).findByRole("link", { name: /Challenges/ });
    expect(within(nav).queryByRole("link", { name: /Vote/ })).not.toBeInTheDocument();

    api.me = { ...api.me, phase: "voting" };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 60_000); // back a minute later: the cache is stale by then
    act(() => { focusManager.setFocused(false); });
    act(() => { focusManager.setFocused(true); });
    expect(await within(nav).findByRole("link", { name: /Vote/ })).toBeInTheDocument();
    focusManager.setFocused(undefined);
  });

  it("refreshes an open screen every few seconds while it's visible", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = studentApi();
    renderAt("/challenges");
    await screen.findByText("Challenge c1");
    const before = api.calls.me;
    await act(() => vi.advanceTimersByTimeAsync(LIVE_MS + 100));
    expect(api.calls.me).toBeGreaterThan(before);
  });
});
