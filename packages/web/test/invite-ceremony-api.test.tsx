// Co-teacher invite acceptance, the projected reveal ceremony, and the API client itself.
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { server } from "./server.js";
import { renderAt } from "./render.js";
import { api, HttpError, errorText } from "../src/api.js";

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
    await screen.findByText("Sortie introuvable.");
    expect(location()).toBe("/teacher/trips/t1");
  });

  it("shows the invite and a sign-in button when not signed in yet", async () => {
    server.use(preview(INVITE), http.post("/api/invites/accept", () => HttpResponse.json({}, { status: 401 })));
    renderAt(url);
    expect(await screen.findByText("Rome 2030")).toBeInTheDocument();
    expect(screen.getByText("co@school.test")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Se connecter et accepter" })).toBeEnabled();
  });

  it.each([
    [200, null],
    [403, "Cette invitation a été envoyée à une autre adresse e-mail. Connecte-toi avec ce compte."],
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
    await user.click(await screen.findByRole("button", { name: "Se connecter et accepter" }));
    if (message) expect(await screen.findByText(message)).toBeInTheDocument();
    else await vi.waitFor(() => expect(location()).toBe("/teacher/trips/t1"));
  });

  it.each([
    ["wrong_account", "Cette invitation a été envoyée à une autre adresse e-mail. Connecte-toi avec ce compte."],
    ["not_found", "Cette invitation n'est pas valide, a déjà été utilisée ou a expiré."],
    ["boom", "Impossible d'accepter l'invitation."],
  ])("explains a refused accept (%s)", async (error, message) => {
    server.use(preview(INVITE), http.post("/api/invites/accept", () => HttpResponse.json({ error }, { status: 403 })));
    renderAt(url);
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it.each([
    [{ ...INVITE, expired: true }, 200, "Invitation expirée"],
    [{ error: "not_found" }, 404, "Invitation introuvable"],
  ])("says when the invite is unusable (%#)", async (body, status, heading) => {
    server.use(preview(body, status), http.post("/api/invites/accept", () => HttpResponse.json({}, { status: 401 })));
    renderAt(url);
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
  });

  it("needs a token", () => {
    server.use(http.get("/api/invites/preview", () => HttpResponse.json({}, { status: 400 })));
    renderAt("/teacher/accept");
    expect(screen.getByText("Jeton d'invitation manquant.")).toBeInTheDocument();
  });
});

// #80: every screen shows the shimmer placeholder while it loads, never bare "Loading…".
describe("loading placeholders", () => {
  it.each([
    ["the invite preview", "/teacher/accept?token=t", "/api/invites/preview"],
    ["the ceremony", "/ceremony/t1", "/api/trips/t1/results"],
  ])("%s", async (_label, path, endpoint) => {
    server.use(http.get(endpoint, async () => { await delay("infinite"); return HttpResponse.json({}); }));
    renderAt(path);
    expect(await screen.findByRole("status", { name: "Chargement" })).toBeInTheDocument();
    expect(screen.queryByText(/Chargement…/)).not.toBeInTheDocument();
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
    expect(await screen.findByText("Et les gagnants sont…")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("heading", { name: "Gelato" })).toBeInTheDocument();
    // Podium only (top 3), revealed bottom-up: 3rd first, the winner last.
    expect([...document.querySelectorAll("h2 + div > div")].map((d) => d.textContent))
      .toEqual(["🥉Bats1 pts", "🥈Owls3 pts", "🥇Foxes5 pts"]);

    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByRole("heading", { name: "Fountain" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dévoiler →" }));
    expect(screen.getByText("Grand champion")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Foxes/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dévoiler →" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Enter" }); // already at the end: stays
    expect(screen.getByText("Grand champion")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByRole("heading", { name: "Fountain" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "← Retour" }));
    fireEvent.click(screen.getByRole("button", { name: "← Retour" }));
    expect(screen.getByRole("button", { name: "← Retour" })).toBeDisabled();
  });

  it("shows a co-champion tie as such", async () => {
    server.use(http.get("/api/trips/t1/results", () => HttpResponse.json({ results: [
      row("1", "Gelato", 1, "Foxes", 5), row("2", "", 1, "Foxes", 5, true), row("3", "", 1, "Owls", 5, true),
    ] })));
    renderAt("/ceremony/t1");
    await screen.findByText("Et les gagnants sont…");
    fireEvent.click(screen.getByRole("button", { name: "Dévoiler →" }));
    fireEvent.click(screen.getByRole("button", { name: "Dévoiler →" }));
    expect(screen.getByText("(égalité — l'enseignant tranche)")).toBeInTheDocument();
  });

  // #166 + #170: the photos that won, on the projector, one full-screen slide per team,
  // 3rd → 1st; tied teams each get their slide. The name comes in after the photo (CSS delay).
  it("reveals the podium photo by photo, 3rd to 1st, every tied team included", async () => {
    const shot = (r: ReturnType<typeof row>, photo: string | null) => ({ ...r, photo_id: photo });
    server.use(http.get("/api/trips/t1/results", () => HttpResponse.json({ results: [
      shot(row("1", "Gelato", 1, "Foxes", 5), "p1"), shot(row("2", "Gelato", 2, "Owls", 3), "p2"),
      shot(row("3", "Gelato", 3, "Bats", 1), "p3"), shot(row("4", "Gelato", 3, "Moles", 1), null),
      shot(row("5", "Gelato", 5, "Eels", 0), "p5"),
      shot(row("6", "", 1, "Foxes", 5, true), "p1"),
    ] })));
    renderAt("/ceremony/t1");
    await screen.findByText("Et les gagnants sont…");
    const reveal = () => fireEvent.click(screen.getByRole("button", { name: "Dévoiler →" }));
    /** What the slide shows: its place, its team, and its photo if any. */
    const slide = () => ({
      place: screen.getByTestId("place").textContent,
      team: screen.getByTestId("team").textContent,
      photo: screen.queryByRole("img")?.getAttribute("src") ?? null,
    });

    reveal();
    expect(screen.getByRole("heading", { name: "Gelato" })).toBeInTheDocument();
    expect(slide()).toEqual({ place: "🥉 3e place (ex aequo)", team: "Bats · 1 pts", photo: "/api/submissions/p3/photo" });
    expect(screen.getByRole("img", { name: "Photo de Bats" })).toBeInTheDocument();
    reveal();
    expect(slide()).toEqual({ place: "🥉 3e place (ex aequo)", team: "Moles · 1 pts", photo: null }); // no photo: its name only
    reveal();
    expect(slide()).toEqual({ place: "🥈 2e place", team: "Owls · 3 pts", photo: "/api/submissions/p2/photo" });
    reveal();
    expect(slide()).toEqual({ place: "🥇 1re place", team: "Foxes · 5 pts", photo: "/api/submissions/p1/photo" });

    fireEvent.click(screen.getByRole("button", { name: "← Retour" })); // back slides the other way
    expect(slide().team).toBe("Owls · 3 pts");
    reveal();
    reveal(); // no recap slide: 1st place goes straight on (5th place is never shown)
    expect(screen.getByText("Grand champion")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Photo de Foxes" })).toHaveAttribute("src", "/api/submissions/p1/photo");
  });

  it("says when there are no results yet", async () => {
    server.use(http.get("/api/trips/t1/results", () => HttpResponse.json({ results: [] })));
    renderAt("/ceremony/t1");
    expect(await screen.findByRole("heading", { name: "Pas encore de résultats" })).toBeInTheDocument();
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

  // #69: the API answers { error, message, requestId }; screens show the reason and, when
  // something broke on our side, a reference the user can report.
  it("exposes the error code and the request id (body first, then the header)", async () => {
    server.use(
      http.get("/api/teams", () => HttpResponse.json(
        { error: "storage_unavailable", message: "Photo storage is unavailable right now.", requestId: "req-body" },
        { status: 503, headers: { "x-request-id": "req-header" } },
      )),
      http.post("/api/teams/join", () => new HttpResponse("Bad Gateway", { status: 502, headers: { "x-request-id": "req-edge" } })),
    );
    const err = (p: Promise<unknown>) => p.then(() => { throw new Error("resolved"); }, (e: HttpError) => e);

    const down = await err(api.listTeams());
    expect([down.status, down.code, down.requestId]).toEqual([503, "storage_unavailable", "req-body"]);
    expect(errorText(down)).toBe("Photo storage is unavailable right now. Référence : req-body");

    const edge = await err(api.joinTeam("t"));
    expect([edge.code, edge.requestId]).toEqual([null, "req-edge"]);
  });

  it("gives each failure kind a plain reason when the body has none", async () => {
    server.use(
      http.get("/api/teams", () => new HttpResponse(null, { status: 503 })),
      http.post("/api/teams/join", () => new HttpResponse(null, { status: 429 })),
      http.post("/api/teams/leave", () => HttpResponse.error()),
    );
    const err = (p: Promise<unknown>) => p.then(() => { throw new Error("resolved"); }, (e: HttpError) => e);

    expect((await err(api.listTeams())).reason).toMatch(/momentanément indisponible/);
    expect((await err(api.joinTeam("t"))).reason).toMatch(/occupé/);
    const offline = await err(api.leaveTeam());
    expect(offline).toBeInstanceOf(HttpError);
    expect([offline.status, offline.reason]).toEqual([0, "Impossible de joindre le serveur. Vérifie ta connexion et réessaie."]);
  });

  it("shows a reference only when something broke on our side", () => {
    const refused = new HttpError(409, JSON.stringify({ error: "locked", message: "Teams are locked.", requestId: "r1" }));
    expect(errorText(refused)).toBe("Teams are locked.");
    expect(errorText(new Error("boom"), "Could not save.")).toBe("Could not save.");
  });

  it("builds photo and QR URLs", () => {
    expect(api.photoUrl("s1")).toBe("/api/submissions/s1/photo");
    expect(api.qrUrl("c1")).toBe("/api/challenges/c1/qr.png");
  });
});
