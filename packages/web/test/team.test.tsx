// Team formation (CONTEXT: Team): create / join / leave while the trip is in draft.
import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "./server.js";
import { renderAt } from "./render.js";

const ME = { studentId: "s1", tripId: "t1", tripName: "Rome 2030", phase: "draft", teamId: null as string | null };

/** A tiny stateful fake of the team endpoints. */
function teamApi(start: {
  teamId?: string | null; phase?: string; teams?: { id: string; name: string; members: number }[]; challenges?: string[];
} = {}) {
  const state = { teamId: start.teamId ?? null, teams: start.teams ?? [], calls: [] as string[] };
  const challenges = (start.challenges ?? []).map((title, i) => ({
    id: `c${i}`, title, instructions: "", qrSlug: `s${i}`, photos: 0, nominated: false, vote: null,
  }));
  server.use(
    http.get("/api/challenges/for-student", () => HttpResponse.json({ challenges })),
    http.get("/api/student/me", () => HttpResponse.json({ ...ME, phase: start.phase ?? "draft", teamId: state.teamId })),
    http.get("/api/teams", () => HttpResponse.json({ teams: state.teams })),
    http.post("/api/teams", async ({ request }) => {
      const { name } = (await request.json()) as { name: string };
      state.calls.push(`create ${name}`);
      state.teams.push({ id: "new", name, members: 1 });
      state.teamId = "new";
      return HttpResponse.json({ teamId: "new" }, { status: 201 });
    }),
    http.post("/api/teams/join", async ({ request }) => {
      const { teamId } = (await request.json()) as { teamId: string };
      state.calls.push(`join ${teamId}`);
      if (teamId === "full") return HttpResponse.json({ error: "full", message: "team is full" }, { status: 409 });
      state.teamId = teamId;
      return HttpResponse.json({ ok: true });
    }),
    http.post("/api/teams/leave", () => {
      state.calls.push("leave");
      state.teamId = null;
      return HttpResponse.json({ ok: true });
    }),
  );
  return state;
}

describe("teams page", () => {
  it("is locked once the challenge period has started — a student without a team can still vote", async () => {
    teamApi({ phase: "challenge" });
    renderAt("/team");
    expect(await screen.findByText("Teams are locked")).toBeInTheDocument();
    expect(screen.getByText("You can still vote when voting opens.")).toBeInTheDocument();
  });

  it("locked without a team during voting points straight to the vote", async () => {
    teamApi({ phase: "voting" });
    renderAt("/team");
    expect(await screen.findByText("Teams are locked")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Go vote/ })).toHaveAttribute("href", "/vote");
  });

  it("creates a team with a trimmed name and switches to the in-team view", async () => {
    const api = teamApi();
    const { user } = renderAt("/team");
    const create = await screen.findByRole("button", { name: "Create team" });
    expect(create).toBeDisabled();
    expect(screen.getByText("No teams yet")).toBeInTheDocument();
    await user.type(screen.getByLabelText("New team name"), "  Foxes ");
    await user.click(create);
    expect(await screen.findByRole("button", { name: "Leave team" })).toBeInTheDocument();
    expect(api.calls).toEqual(["create Foxes"]);
  });

  it("joins a listed team, and can leave it again", async () => {
    const api = teamApi({ teams: [{ id: "owls", name: "Owls", members: 1 }, { id: "bats", name: "Bats", members: 3 }] });
    const { user } = renderAt("/team");
    expect(await screen.findByText("1 member")).toBeInTheDocument();
    expect(screen.getByText("3 members")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Join" })[0]!);
    await user.click(await screen.findByRole("button", { name: "Leave team" }));
    expect(await screen.findByRole("button", { name: "Create team" })).toBeInTheDocument();
    expect(api.calls).toEqual(["join owls", "leave"]);
  });

  it("shows why a join was refused", async () => {
    teamApi({ teams: [{ id: "full", name: "Full", members: 4 }] });
    const { user } = renderAt("/team");
    await user.click(await screen.findByRole("button", { name: "Join" }));
    expect(await screen.findByText("team is full")).toBeInTheDocument();
  });

  it("after joining: shows my team, what happens next, and a preview of the challenges", async () => {
    teamApi({ teamId: "owls", teams: [{ id: "owls", name: "Owls", members: 2 }], challenges: ["Gelato", "Pyramid"] });
    renderAt("/team");
    expect(await screen.findByRole("heading", { name: "Owls" })).toBeInTheDocument();
    expect(screen.getByText("2 members")).toBeInTheDocument();

    const steps = within(screen.getByRole("list", { name: "Next steps" })).getAllByRole("listitem");
    expect(steps.map((li) => li.textContent?.replace(/^\W*\d?/, ""))).toEqual([
      "Team joined", "Wait for the start", "Snap the challenges", "Vote for the best",
    ]);
    expect(steps[1]).toHaveAttribute("aria-current", "step");

    expect(await screen.findByText("Coming up")).toBeInTheDocument();
    expect(screen.getByText("Pyramid")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join" })).not.toBeInTheDocument();
  });

  it("hides the preview when the trip has no challenges yet", async () => {
    teamApi({ teamId: "owls", teams: [{ id: "owls", name: "Owls", members: 1 }] });
    renderAt("/team");
    expect(await screen.findByText("1 member")).toBeInTheDocument();
    expect(screen.queryByText("Coming up")).not.toBeInTheDocument();
  });

  it.each([
    ["challenge", "Snap the challenges", /See your challenges/, "/challenges"],
    ["voting", "Vote for the best", /Go vote/, "/vote"],
    ["reveal", "Winners revealed", null, null],
  ] as const)("locked in %s with a team: the current step is “%s”", async (phase, current, link, href) => {
    teamApi({ phase, teamId: "owls", teams: [{ id: "owls", name: "Owls", members: 3 }] });
    renderAt("/team");
    expect(await screen.findByRole("heading", { name: "Owls" })).toBeInTheDocument();
    const steps = within(screen.getByRole("list", { name: "Next steps" })).getAllByRole("listitem");
    expect(steps.find((li) => li.getAttribute("aria-current") === "step")).toHaveTextContent(current);
    if (link) expect(screen.getByRole("link", { name: link })).toHaveAttribute("href", href);
    expect(screen.queryByRole("button", { name: "Leave team" })).not.toBeInTheDocument();
  });
});
