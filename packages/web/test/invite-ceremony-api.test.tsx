// Co-teacher invite acceptance, the projected reveal ceremony, and the API client itself.
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "./server.js";
import { renderAt } from "./render.js";
import { api, HttpError } from "../src/api.js";

describe("accept invite (/teacher/accept?token=…)", () => {
  const preview = (body: object, status = 200) =>
    http.get("/api/invites/preview", ({ request }) => {
      expect(new URL(request.url).searchParams.get("token")).toBe("tok/+=");
      return HttpResponse.json(body, { status });
    });
  const url = `/teacher/accept?token=${encodeURIComponent("tok/+=")}`;
  const INVITE = { email: "co@school.test", trip_name: "Rome 2030", expired: false };

  it("accepts straight away when already signed in, and opens the trip", async () => {
    server.use(
      preview(INVITE),
      http.post("/api/invites/accept", () => HttpResponse.json({ ok: true, tripId: "t1" })),
      http.get("/api/trips/t1", () => HttpResponse.json({}, { status: 404 })), // the admin screen mounts next
    );
    const { location } = renderAt(url);
    await screen.findByText("Not found.");
    expect(location()).toBe("/teacher/trips/t1");
  });

  it("shows the invite and a sign-in button when not signed in yet", async () => {
    server.use(preview(INVITE), http.post("/api/invites/accept", () => HttpResponse.json({}, { status: 401 })));
    renderAt(url);
    expect(await screen.findByText("Rome 2030")).toBeInTheDocument();
    expect(screen.getByText("co@school.test")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in & accept" })).toBeEnabled();
  });

  it.each([
    [200, null],
    [403, "This invite was sent to a different email address. Sign in with that account."],
  ])("accepts on the button once signed in elsewhere (API answered %i)", async (status, message) => {
    let calls = 0;
    server.use(
      preview(INVITE),
      http.post("/api/invites/accept", () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({}, { status: 401 }); // the automatic attempt
        return status === 200
          ? HttpResponse.json({ ok: true, tripId: "t1" })
          : HttpResponse.json({ error: "wrong_account" }, { status });
      }),
      http.get("/api/trips/t1", () => HttpResponse.json({}, { status: 404 })),
    );
    const { user, location } = renderAt(url);
    await user.click(await screen.findByRole("button", { name: "Sign in & accept" }));
    if (message) expect(await screen.findByText(message)).toBeInTheDocument();
    else await vi.waitFor(() => expect(location()).toBe("/teacher/trips/t1"));
  });

  it.each([
    ["wrong_account", "This invite was sent to a different email address. Sign in with that account."],
    ["not_found", "This invite is invalid, already used, or expired."],
    ["boom", "Could not accept the invite."],
  ])("explains a refused accept (%s)", async (error, message) => {
    server.use(preview(INVITE), http.post("/api/invites/accept", () => HttpResponse.json({ error }, { status: 403 })));
    renderAt(url);
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it.each([
    [{ ...INVITE, expired: true }, 200, "Invite expired"],
    [{ error: "not_found" }, 404, "Invite not found"],
  ])("says when the invite is unusable (%#)", async (body, status, heading) => {
    server.use(preview(body, status), http.post("/api/invites/accept", () => HttpResponse.json({}, { status: 401 })));
    renderAt(url);
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
  });

  it("needs a token", () => {
    server.use(http.get("/api/invites/preview", () => HttpResponse.json({}, { status: 400 })));
    renderAt("/teacher/accept");
    expect(screen.getByText("Missing invite token.")).toBeInTheDocument();
  });
});

describe("ceremony (/ceremony/:id)", () => {
  const row = (id: string, challenge: string, placement: number, team: string, points: number, champ = false) =>
    ({ id, challenge_title: challenge, placement, team_name_vetted: team, points, is_grand_champion: champ });

  it("steps from the intro through each podium to the Grand Champion, and back", async () => {
    server.use(http.get("/api/trips/t1/results", () => HttpResponse.json({ results: [
      row("1", "Gelato", 2, "Owls", 3), row("2", "Gelato", 1, "Foxes", 5), row("3", "Gelato", 3, "Bats", 1),
      row("4", "Gelato", 4, "Moles", 0),
      row("5", "Fountain", 1, "Owls", 5),
      row("6", "", 1, "Foxes", 6, true),
    ] })));
    renderAt("/ceremony/t1");
    expect(await screen.findByText("And the winners are…")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("heading", { name: "Gelato" })).toBeInTheDocument();
    // Podium only (top 3), revealed bottom-up: 3rd first, the winner last.
    expect([...document.querySelectorAll("h2 + div > div")].map((d) => d.textContent))
      .toEqual(["🥉Bats1 pts", "🥈Owls3 pts", "🥇Foxes5 pts"]);

    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByRole("heading", { name: "Fountain" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reveal →" }));
    expect(screen.getByText("Grand Champion")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Foxes/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reveal →" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Enter" }); // already at the end: stays
    expect(screen.getByText("Grand Champion")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByRole("heading", { name: "Fountain" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(screen.getByRole("button", { name: "← Back" })).toBeDisabled();
  });

  it("shows a co-champion tie as such", async () => {
    server.use(http.get("/api/trips/t1/results", () => HttpResponse.json({ results: [
      row("1", "Gelato", 1, "Foxes", 5), row("2", "", 1, "Foxes", 5, true), row("3", "", 1, "Owls", 5, true),
    ] })));
    renderAt("/ceremony/t1");
    await screen.findByText("And the winners are…");
    fireEvent.click(screen.getByRole("button", { name: "Reveal →" }));
    fireEvent.click(screen.getByRole("button", { name: "Reveal →" }));
    expect(screen.getByText("(a tie — teacher decides)")).toBeInTheDocument();
  });

  it("says when there are no results yet", async () => {
    server.use(http.get("/api/trips/t1/results", () => HttpResponse.json({ results: [] })));
    renderAt("/ceremony/t1");
    expect(await screen.findByRole("heading", { name: "No results yet" })).toBeInTheDocument();
  });
});

describe("api client", () => {
  it("sends cookies and JSON, and parses JSON back", async () => {
    let seen: { credentials: RequestCredentials; type: string | null; body: unknown } | undefined;
    server.use(http.post("/api/teams", async ({ request }) => {
      seen = { credentials: request.credentials, type: request.headers.get("content-type"), body: await request.json() };
      return HttpResponse.json({ teamId: "x" }, { status: 201 });
    }));
    expect(await api.createTeam("Foxes")).toEqual({ teamId: "x" });
    expect(seen).toEqual({ credentials: "include", type: "application/json", body: { name: "Foxes" } });
  });

  it("returns undefined for 204 No Content", async () => {
    server.use(http.post("/api/teams/leave", () => new HttpResponse(null, { status: 204 })));
    expect(await api.leaveTeam()).toBeUndefined();
  });

  it("turns failures into HttpError with the status and the API's reason", async () => {
    server.use(
      http.get("/api/student/me", () => HttpResponse.json({ error: "unauthorized" }, { status: 401 })),
      http.get("/api/teams", () => HttpResponse.json({ error: "locked", message: "teams are locked" }, { status: 409 })),
      http.post("/api/teams/join", () => new HttpResponse("upstream down", { status: 502 })),
    );
    const err = (p: Promise<unknown>) => p.then(() => { throw new Error("resolved"); }, (e: HttpError) => e);

    const unauth = await err(api.me());
    expect(unauth).toBeInstanceOf(HttpError);
    expect([unauth.status, unauth.message]).toEqual([401, "unauthorized"]);

    const locked = await err(api.listTeams());
    expect([locked.status, locked.reason]).toEqual([409, "teams are locked"]);
    expect(locked.message).toContain('"error":"locked"'); // callers match on the error code

    const raw = await err(api.joinTeam("t"));
    expect([raw.status, raw.reason]).toEqual([502, "upstream down"]);
  });

  it("builds photo and QR URLs", () => {
    expect(api.photoUrl("s1")).toBe("/api/submissions/s1/photo");
    expect(api.qrUrl("c1")).toBe("/api/challenges/c1/qr.png");
  });
});
