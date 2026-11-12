// Teacher UI: sign-in gate, trip list/creation, and the trip admin screen.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { server } from "./server.js";
import { renderAt } from "./render.js";
import { LIVE_MS } from "../src/query.js";

const TEACHER = { id: "tch1", email: "owner@school.test", display_name: "Owner" };
/** An outage answer, as the API gives it (#69). */
const down = (requestId = "r-1") =>
  HttpResponse.json({ error: "database_unavailable", message: "The database is unavailable right now.", requestId }, { status: 503 });

describe("teacher home", () => {
  it("asks a signed-out teacher to sign in", async () => {
    server.use(
      http.get("/api/auth/teacher/me", () => HttpResponse.json({}, { status: 401 })),
      http.get("/api/trips", () => HttpResponse.json({}, { status: 401 })),
    );
    renderAt("/teacher");
    expect(await screen.findByRole("button", { name: "Se connecter avec PocketID" })).toBeInTheDocument();
  });

  // #69: an outage must never read as "you have no trips".
  it("explains a trip list that failed to load, and retries", async () => {
    let failing = true;
    server.use(
      http.get("/api/auth/teacher/me", () => HttpResponse.json(TEACHER)),
      http.get("/api/trips", () => failing ? down("r-trips") : HttpResponse.json({ trips: [] })),
    );
    const { user } = renderAt("/teacher");
    expect(await screen.findByText("The database is unavailable right now.")).toBeInTheDocument();
    expect(screen.getByText(/^Référence :/)).toHaveTextContent("r-trips");
    expect(screen.queryByText("Pas encore de sortie")).not.toBeInTheDocument();
    failing = false;
    await user.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Pas encore de sortie")).toBeInTheDocument();
  });

  it("explains a failed sign-in check instead of showing an empty home", async () => {
    server.use(
      http.get("/api/auth/teacher/me", () => down()),
      http.get("/api/trips", () => down()),
    );
    renderAt("/teacher");
    expect((await screen.findAllByText("The database is unavailable right now.")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Se connecter avec PocketID" })).not.toBeInTheDocument();
  });

  const home = (trips: object[]) => server.use(
    http.get("/api/auth/teacher/me", () => HttpResponse.json(TEACHER)),
    http.get("/api/trips", () => HttpResponse.json({ trips })),
  );

  it("shows each trip as a card with its phase and role; erased trips sit apart", async () => {
    home([
      { id: "t1", name: "Rome 2030", phase: "challenge", role: "owner", trip_end_date: "2030-01-01" },
      { id: "t2", name: "Oslo 2030", phase: "voting", role: "co", trip_end_date: "2030-03-01" },
      { id: "t0", name: "Lyon 2029", phase: "erased", role: "owner", trip_end_date: "2029-05-01" },
    ]);
    renderAt("/teacher");
    const rome = await screen.findByRole("link", { name: /Rome 2030/ });
    expect(rome).toHaveAttribute("href", "/teacher/trips/t1");
    expect(rome).toHaveTextContent("Défis");
    expect(rome).toHaveTextContent("Responsable");
    expect(screen.getByRole("link", { name: /Oslo 2030/ })).toHaveTextContent("Co-enseignant");

    const active = screen.getByRole("region", { name: "Tes sorties" });
    const past = screen.getByRole("region", { name: "Sorties passées" });
    expect(within(active).queryByText("Lyon 2029")).not.toBeInTheDocument();
    expect(within(past).getByRole("link", { name: /Lyon 2029/ })).toHaveTextContent("Effacée");
  });

  it("opens the new-trip form on demand and adds the created trip", async () => {
    const trips = [{ id: "t1", name: "Rome 2030", phase: "challenge", role: "owner", trip_end_date: "2030-01-01" }];
    let created: unknown;
    home(trips);
    server.use(http.post("/api/trips", async ({ request }) => {
      created = await request.json();
      trips.unshift({ id: "t2", name: "Paris 2031", phase: "draft", role: "owner", trip_end_date: "2031-01-01" });
      return HttpResponse.json({ id: "t2" }, { status: 201 });
    }));
    const { user } = renderAt("/teacher");
    await screen.findByRole("link", { name: /Rome 2030/ });
    expect(screen.queryByLabelText("Nom")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Nouvelle sortie" }));

    const create = screen.getByRole("button", { name: "Créer la sortie" });
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText("Nom"), " Paris 2031 ");
    await user.type(screen.getByLabelText("Date de fin de la sortie"), "2031-01-01");
    await user.clear(screen.getByLabelText("Taille max. d'une équipe"));
    await user.type(screen.getByLabelText("Taille max. d'une équipe"), "5");
    await user.click(create);

    expect(await screen.findByRole("link", { name: /Paris 2031/ })).toBeInTheDocument();
    expect(created).toEqual({ name: "Paris 2031", tripEndDate: "2031-01-01", maxTeamSize: 5 });
    expect(screen.queryByLabelText("Nom")).not.toBeInTheDocument();
  });

  it("starts with the form open when there are no trips yet", async () => {
    home([]);
    renderAt("/teacher");
    expect(await screen.findByText("Pas encore de sortie")).toBeInTheDocument();
    expect(screen.getByLabelText("Nom")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Annuler" })).not.toBeInTheDocument();
  });

  it("doesn't offer an end date in the past", async () => {
    home([]);
    renderAt("/teacher");
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(await screen.findByLabelText("Date de fin de la sortie")).toHaveAttribute("min", today);
  });

  it("tells the teacher when a trip can't be created", async () => {
    home([]);
    server.use(
      http.post("/api/trips", () => HttpResponse.json({ error: "bad_request", message: "maxTeamSize too big" }, { status: 400 })),
    );
    const { user } = renderAt("/teacher");
    await user.type(await screen.findByLabelText("Nom"), "Paris");
    await user.type(screen.getByLabelText("Date de fin de la sortie"), "2031-01-01");
    await user.click(screen.getByRole("button", { name: "Créer la sortie" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("maxTeamSize too big");
  });
});

type Trip = {
  id: string; name: string; phase: string; max_team_size: number; grace_days: number; max_retention_days: number;
  trip_end_date: string; points_table: { placement: number; points: number }[];
  challenge_opens_at: string | null; voting_opens_at: string | null; voting_closes_at: string | null;
  hard_erase_at?: string;
};

/** A stateful fake of every endpoint the trip admin screen uses. */
function adminApi(over: Partial<Trip> = {}) {
  const s = {
    trip: {
      id: "t1", name: "Rome 2030", phase: "draft", max_team_size: 4, grace_days: 7, max_retention_days: 30,
      trip_end_date: "2030-01-01T00:00:00.000Z", points_table: [{ placement: 1, points: 5 }, { placement: 2, points: 3 }],
      challenge_opens_at: null, voting_opens_at: null, voting_closes_at: null,
      hard_erase_at: "2030-01-31T00:00:00.000Z", ...over,
    } as Trip,
    roster: { pending: 0, done: 3, failed: 0, students: 3 },
    challenges: [{ id: "ch1", title: "Gelato selfie", instructions: "With a gelato", multiplier: 2, qr_slug: "abc" }],
    nominations: [{ id: "n1", challenge_id: "ch1", team_id: "team1", submission_id: "sub1", state: "pending" }],
    teachers: [{ id: "tch1", email: "owner@school.test", display_name: "Owner", role: "owner" }],
    invites: [{ id: "inv1", email: "pending@school.test", expires_at: "2030-01-08" }],
    results: [] as object[],
    progress: {
      students: 3, teams: 1, studentsWithoutTeam: 1, teamsUnreviewed: 0, voters: 0, eraseAt: "2030-02-01T00:00:00.000Z", graceEndsAt: null,
      challenges: [{ id: "ch1", title: "Gelato selfie", teamsWithPhotos: 0, pending: 1, approved: 0, rejected: 0 }],
    },
    calls: [] as string[],
    patches: [] as unknown[],
    advanceRefusal: null as string | null,
    rosterRefusal: false,
    moderationRefusal: null as string | null,
    revokeRefusal: false,
    resendFails: false,
    students: [
      { kind: "student", id: "s1", email: "ana@school.test", status: "joined", newCodeRequested: true, teamId: "team1", lastError: null },
      { kind: "student", id: "s2", email: "tom@school.test", status: "invited", newCodeRequested: false, teamId: null, lastError: null },
      { kind: "student", id: "s3", email: "lea@shcool.test", status: "undelivered", newCodeRequested: false, teamId: null, lastError: "MAILBOX_NOT_FOUND" },
      { kind: "import", id: "i1", email: "orphan@shcool.test", status: "undelivered", newCodeRequested: false, teamId: null, lastError: "ENODOMAIN" },
    ] as { kind: string; id: string; email: string; status: string; newCodeRequested: boolean; teamId: string | null; lastError: string | null }[],
    teams: [
      { id: "team1", name: "Léa & Tom 4B", label: "Team 1", nameReviewed: false, members: ["s1"], photos: 2, challengesEntered: 1,
        nominations: { pending: 1, approved: 0, rejected: 0 } },
    ],
    crownRefusal: false,
    eraseFails: false,
  };
  const ok = (call: string, body: object = { ok: true }) => { s.calls.push(call); return HttpResponse.json(body); };
  server.use(
    http.get("/api/trips/t1", () => HttpResponse.json(s.trip)),
    http.patch("/api/trips/t1", async ({ request }) => {
      const patch = (await request.json()) as Record<string, unknown>;
      if ("maxTeamSize" in patch && s.trip.phase !== "draft") {
        return HttpResponse.json({ error: "locked_in_phase", message: "nope" }, { status: 409 });
      }
      s.patches.push(patch);
      if (typeof patch.name === "string") s.trip.name = patch.name;
      return HttpResponse.json({ ok: true });
    }),
    http.post("/api/trips/t1/advance", async ({ request }) => {
      const { to } = (await request.json()) as { to: string };
      if (s.advanceRefusal) {
        s.trip.phase = s.advanceRefusal; // someone (or the scheduler) moved it first
        return HttpResponse.json({ error: "illegal_transition", message: "illegal" }, { status: 409 });
      }
      s.trip.phase = to;
      return ok(`advance ${to}`, { ok: true, phase: to });
    }),
    http.post("/api/trips/t1/erase", () => {
      s.calls.push("erase");
      s.trip.hard_erase_at = new Date().toISOString();
      if (s.eraseFails) {
        return HttpResponse.json({
          error: "erasure_pending", requestId: "req-7",
          message: "Erasure could not finish yet. It will retry automatically; teachers will be alerted if it keeps failing.",
        }, { status: 503 });
      }
      s.trip.phase = "erased";
      return HttpResponse.json({ ok: true, erased: true });
    }),
    http.get("/api/trips/t1/roster/status", () => HttpResponse.json(s.roster)),
    http.get("/api/trips/t1/progress", () => HttpResponse.json(s.progress)),
    http.get("/api/trips/t1/students", () => {
      const st = s.students;
      const counts = {
        all: st.length,
        notJoined: st.filter((x) => x.status !== "joined").length,
        undelivered: st.filter((x) => x.status === "undelivered").length,
        noTeam: st.filter((x) => x.kind === "student" && !x.teamId).length,
        sending: st.filter((x) => x.status === "sending").length,
      };
      return HttpResponse.json({ students: st, counts });
    }),
    http.post("/api/trips/t1/students/:sid/resend", ({ params }) => {
      if (s.resendFails) return HttpResponse.json({ error: "mail_failed", message: "The email couldn't be sent. Check the address and try again." }, { status: 502 });
      Object.assign(s.students.find((x) => x.id === params.sid)!, { status: "invited", lastError: null });
      return ok(`resend ${params.sid}`);
    }),
    http.patch("/api/trips/t1/students/:sid", async ({ params, request }) => {
      const { email } = (await request.json()) as { email: string };
      Object.assign(s.students.find((x) => x.id === params.sid)!, { email, status: "invited", lastError: null });
      return ok(`fix ${params.sid} ${email}`);
    }),
    http.post("/api/trips/t1/roster/items/:iid/retry", async ({ params, request }) => {
      const { email } = (await request.json()) as { email?: string };
      Object.assign(s.students.find((x) => x.id === params.iid)!, { email: email ?? "", status: "sending", lastError: null });
      s.calls.push(`retry ${params.iid} ${email}`);
      return HttpResponse.json({ ok: true }, { status: 202 });
    }),
    http.get("/api/trips/t1/teams", () => HttpResponse.json({ teams: s.teams, maxTeamSize: s.trip.max_team_size })),
    http.patch("/api/trips/t1/teams/:tid", async ({ params, request }) => {
      const { name } = (await request.json()) as { name: string };
      Object.assign(s.teams.find((x) => x.id === params.tid)!, { name, nameReviewed: true });
      return ok(`rename ${params.tid} ${name}`);
    }),
    http.post("/api/trips/t1/teams/:tid/review", ({ params }) => {
      s.teams.find((x) => x.id === params.tid)!.nameReviewed = true;
      return ok(`review ${params.tid}`);
    }),
    http.post("/api/trips/t1/roster", async ({ request }) => {
      const { emails } = (await request.json()) as { emails: string[] };
      if (s.rosterRefusal) return HttpResponse.json({ error: "bad_request", message: "invalid email" }, { status: 400 });
      s.calls.push(`roster ${emails.join(",")}`);
      s.roster = { ...s.roster, pending: emails.length, students: s.roster.students + emails.length };
      return HttpResponse.json({ queued: emails.length, requested: emails.length }, { status: 202 });
    }),
    http.get("/api/challenges", () => HttpResponse.json({ challenges: s.challenges })),
    http.post("/api/challenges", async ({ request }) => {
      const body = (await request.json()) as { title: string; instructions: string; multiplier: number };
      if (body.title === "Refused") return HttpResponse.json({ error: "bad_request", message: "multiplier must be positive" }, { status: 400 });
      s.calls.push(`create ${JSON.stringify(body)}`);
      s.challenges.push({ id: "ch2", qr_slug: "def", ...body });
      return HttpResponse.json({ id: "ch2", qrSlug: "def" }, { status: 201 });
    }),
    http.patch("/api/challenges/:id", async ({ params, request }) => {
      const body = (await request.json()) as { title: string };
      s.calls.push(`edit ${params.id} ${JSON.stringify(body)}`);
      Object.assign(s.challenges.find((c) => c.id === params.id)!, body);
      return HttpResponse.json({ ok: true });
    }),
    http.delete("/api/challenges/:id", ({ params }) => {
      s.challenges = s.challenges.filter((c) => c.id !== params.id);
      return ok(`delete ${params.id}`);
    }),
    http.get("/api/nominations/trip/t1", ({ request }) => {
      const state = new URL(request.url).searchParams.get("state");
      return HttpResponse.json({ nominations: s.nominations.filter((n) => !state || n.state === state) });
    }),
    http.post("/api/nominations/:id/:decision", ({ params }) => {
      if (s.moderationRefusal) return HttpResponse.json({ error: "closed", message: s.moderationRefusal }, { status: 409 });
      const n = s.nominations.find((x) => x.id === params.id)!;
      n.state = params.decision === "approve" ? "approved" : "rejected";
      return ok(`${params.decision} ${params.id}`);
    }),
    http.post("/api/submissions/:id/remove", ({ params }) => {
      s.nominations = s.nominations.filter((n) => n.submission_id !== params.id);
      return ok(`remove ${params.id}`);
    }),
    http.get("/api/trips/t1/teachers", () => HttpResponse.json({ teachers: s.teachers })),
    http.get("/api/trips/t1/invites", () => HttpResponse.json({ invites: s.invites })),
    http.post("/api/trips/t1/invites", async ({ request }) => {
      const { email } = (await request.json()) as { email: string };
      if (email === "owner@school.test") return HttpResponse.json({ error: "already_member" }, { status: 409 });
      if (email === "nope@school.test") return HttpResponse.json({ error: "forbidden" }, { status: 403 });
      s.invites.push({ id: "inv2", email, expires_at: "2030-01-08" });
      return HttpResponse.json({ invited: email }, { status: 201 });
    }),
    http.delete("/api/trips/t1/invites/:inviteId", ({ params }) => {
      if (s.revokeRefusal) return HttpResponse.json({ error: "forbidden", message: "Only the trip owner can revoke invites." }, { status: 403 });
      s.invites = s.invites.filter((i) => i.id !== params.inviteId);
      return ok(`revoke ${params.inviteId}`);
    }),
    http.get("/api/trips/t1/results", () => HttpResponse.json({ results: s.results })),
    http.post("/api/trips/t1/grand-champion", async ({ request }) => {
      const { resultId } = (await request.json()) as { resultId: string };
      if (s.crownRefusal) return HttpResponse.json({ error: "closed", message: "The ceremony is over." }, { status: 409 });
      s.results = s.results.filter((r: any) => !r.is_grand_champion || r.id === resultId);
      return ok(`crown ${resultId}`);
    }),
  );
  return s;
}

const card = (heading: string) => screen.getByRole("heading", { name: heading }).closest(".card") as HTMLElement;
const nav = () => screen.getByRole("navigation", { name: "Sections de la sortie" });

describe("trip admin", () => {
  describe("live data", () => {
    afterEach(() => { vi.useRealTimers(); });

    it("switching sections shows what's cached at once, then refreshes it", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/overview");
      const tile = (k: string) => [...document.querySelectorAll(".tile")].find((t) => t.querySelector(".k")?.textContent === k);
      await waitFor(() => expect(tile("Élèves")).toHaveTextContent("3"));
      await screen.findByRole("heading", { name: "Préparation" });
      await user.click(within(nav()).getByRole("link", { name: "Défis" }));
      await screen.findByText("Gelato selfie");
      // From now on the server is slow: only a cache can show the overview right away.
      server.use(http.get("/api/trips/t1/progress", async () => { await delay(400); return HttpResponse.json(api.progress); }));
      await user.click(within(nav()).getByRole("link", { name: "Vue d'ensemble" }));
      expect(screen.getByRole("heading", { name: "Préparation" })).toBeInTheDocument(); // no skeleton, no wait
      expect(tile("Élèves")).toHaveTextContent("3");
    });

    it("an open screen picks up what changed elsewhere: a new nomination, a scheduled phase change", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const api = adminApi();
      renderAt("/teacher/trips/t1/review");
      expect(await screen.findByRole("link", { name: "Modération, 1 en attente" })).toBeInTheDocument();

      api.nominations.push({ id: "n2", challenge_id: "ch1", team_id: "team2", submission_id: "sub2", state: "pending" });
      api.trip.phase = "challenge"; // the planned date passed
      await act(() => vi.advanceTimersByTimeAsync(LIVE_MS + 100));
      expect(await within(nav()).findByRole("link", { name: "Modération, 2 en attente" })).toBeInTheDocument();
      expect(screen.getByText("Défis", { selector: ".trip-head .pill" })).toBeInTheDocument();
    });

    it("an action refreshes the rest of the trip: approving updates the overview counts", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/review");
      const queue = await screen.findByRole("region", { name: "En attente de modération" });
      await user.click(await within(queue).findByRole("button", { name: "Valider" }));
      api.progress.challenges[0]!.approved = 1;
      api.progress.challenges[0]!.pending = 0;
      await within(queue).findByText("Rien à modérer");
      await user.click(within(nav()).getByRole("link", { name: "Vue d'ensemble" }));
      const tile = () => [...document.querySelectorAll(".tile")].find((t) => t.querySelector(".k")?.textContent === "À modérer");
      await waitFor(() => expect(tile()).toHaveTextContent("0"));
      expect(tile()).not.toHaveClass("flag");
    });
  });

  describe("layout", () => {
    it("lands on the overview with a section nav; Review shows what's pending", async () => {
      adminApi();
      const { location } = renderAt("/teacher/trips/t1");
      expect(await screen.findByRole("heading", { name: "Rome 2030" })).toBeInTheDocument();
      await waitFor(() => expect(location()).toBe("/teacher/trips/t1/overview"));
      expect(within(nav()).getByRole("link", { name: "Vue d'ensemble" })).toHaveAttribute("aria-current", "page");
      for (const [label, path] of [["Défis", "challenges"], ["Élèves", "students"], ["Paramètres", "settings"]]) {
        expect(within(nav()).getByRole("link", { name: label })).toHaveAttribute("href", `/teacher/trips/t1/${path}`);
      }
      expect(await within(nav()).findByRole("link", { name: "Modération, 1 en attente" })).toHaveAttribute("href", "/teacher/trips/t1/review");
      expect(within(nav()).queryByRole("link", { name: "Résultats" })).not.toBeInTheDocument();
    });

    it("lands on the results during the reveal", async () => {
      adminApi({ phase: "reveal" });
      const { location } = renderAt("/teacher/trips/t1");
      await waitFor(() => expect(location()).toBe("/teacher/trips/t1/results"));
      expect(await screen.findByRole("heading", { name: "Résultats et cérémonie" })).toBeInTheDocument();
      expect(within(nav()).getByRole("link", { name: "Résultats" })).toHaveAttribute("aria-current", "page");
    });

    it("says so for a trip it can't load", async () => {
      server.use(http.get("/api/trips/zzz", () => HttpResponse.json({}, { status: 404 })));
      renderAt("/teacher/trips/zzz");
      expect(await screen.findByText("Sortie introuvable.")).toBeInTheDocument();
    });
  });

  describe("overview", () => {
    it("summarises the trip; the review tile is flagged and opens the review", async () => {
      adminApi();
      const { user, location } = renderAt("/teacher/trips/t1/overview");
      const tile = (k: string) => [...document.querySelectorAll(".tile")].find((t) => t.querySelector(".k")?.textContent === k)!;
      await waitFor(() => expect(tile("Élèves")).toHaveTextContent("3"));
      expect(tile("Équipes")).toHaveTextContent("1");
      expect(tile("Défis")).toHaveTextContent("1");
      await waitFor(() => expect(tile("À modérer")).toHaveTextContent("1"));
      expect(tile("À modérer")).toHaveClass("flag");
      await user.click(screen.getByRole("link", { name: /À modérer/ }));
      expect(location()).toBe("/teacher/trips/t1/review");
    });

    it("lists what's ready and what's missing, each linking to where it's done", async () => {
      adminApi();
      renderAt("/teacher/trips/t1/overview");
      const now = await waitFor(() => card("Préparation"));
      expect(await within(now).findByRole("link", { name: /Importer la liste d'élèves/ })).toHaveAttribute("href", "/teacher/trips/t1/students");
      expect(within(now).getByRole("link", { name: /Ajouter des défis/ })).toHaveTextContent("1 défi");
      expect(within(now).getByRole("link", { name: /Les élèves forment les équipes/ })).toHaveTextContent("1 sans équipe");
      expect(within(now).getByRole("link", { name: /Planifier les dates/ })).toHaveAttribute("href", "/teacher/trips/t1/settings");
    });

    it("warns when student data is about to be erased", async () => {
      const api = adminApi({ phase: "voting" });
      api.progress.eraseAt = new Date(Date.now() + 2.2 * 86_400_000).toISOString();
      renderAt("/teacher/trips/t1/overview");
      expect(await screen.findByText("Les données des élèves seront effacées après-demain.")).toBeInTheDocument();
    });

    it("keeps erasure away from the everyday controls", async () => {
      adminApi();
      renderAt("/teacher/trips/t1/overview");
      await screen.findByRole("heading", { name: "Préparation" });
      expect(screen.queryByRole("button", { name: /Effacer/ })).not.toBeInTheDocument();
    });
  });

  describe("lifecycle", () => {
    it("moves the trip on after confirming what that does", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/overview");
      await user.click(await screen.findByRole("button", { name: "Lancer les défis →" }));
      const dialog = screen.getByRole("alertdialog", { name: "Lancer les défis ?" });
      expect(dialog).toHaveTextContent("1 élève n'a pas encore d'équipe");
      await user.click(within(dialog).getByRole("button", { name: "Lancer les défis" }));
      expect(await screen.findByRole("heading", { name: "Défis en cours" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Ouvrir le vote →" })).toBeInTheDocument();
      expect(api.calls).toContain("advance challenge");
    });

    it("does nothing when the teacher cancels", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/overview");
      await user.click(await screen.findByRole("button", { name: "Lancer les défis →" }));
      await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Annuler" }));
      expect(api.calls).not.toContain("advance challenge");
      expect(screen.getByRole("heading", { name: "Préparation" })).toBeInTheDocument();
    });

    it("catches up when the trip already moved on (another teacher, or the planned date)", async () => {
      const api = adminApi();
      api.advanceRefusal = "challenge";
      const { user } = renderAt("/teacher/trips/t1/overview");
      await user.click(await screen.findByRole("button", { name: "Lancer les défis →" }));
      await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Lancer les défis" }));
      expect(await screen.findByRole("button", { name: "Ouvrir le vote →" })).toBeInTheDocument();
    });

    it("explains an advance that failed for another reason", async () => {
      adminApi();
      server.use(http.post("/api/trips/t1/advance", () => HttpResponse.json({ error: "oops", message: "Vault is unreachable." }, { status: 503 })));
      const { user } = renderAt("/teacher/trips/t1/overview");
      await user.click(await screen.findByRole("button", { name: "Lancer les défis →" }));
      await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Lancer les défis" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Vault is unreachable.");
    });
  });

  describe("settings", () => {
    it("saves only what changed, with planned dates as instants, and keeps “Saved.” visible (#30)", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/settings");
      const name = await screen.findByLabelText("Nom de la sortie");
      await user.clear(name);
      await user.type(name, "Rome 2031");
      await user.type(screen.getByLabelText("Clôture du vote"), "2030-01-05T18:30");
      await user.click(screen.getByRole("button", { name: "+ place" }));
      await user.click(screen.getByRole("button", { name: "Enregistrer les paramètres" }));

      expect(await screen.findByText("Enregistré.")).toBeInTheDocument();
      expect(await screen.findByRole("heading", { name: "Rome 2031" })).toBeInTheDocument();
      expect(screen.getByText("Enregistré.")).toBeInTheDocument();
      expect(api.patches).toEqual([{
        name: "Rome 2031",
        votingClosesAt: new Date("2030-01-05T18:30").toISOString(),
        pointsTable: [{ placement: 1, points: 5 }, { placement: 2, points: 3 }, { placement: 3, points: 0 }],
      }]);
    });

    it("shows planned dates in local time, and saves retention, end date and points edits", async () => {
      const api = adminApi({ challenge_opens_at: "2029-12-20T08:00:00.000Z" });
      const { user } = renderAt("/teacher/trips/t1/settings");
      const opens = await screen.findByLabelText("Ouverture des défis");
      expect(new Date((opens as HTMLInputElement).value).toISOString()).toBe("2029-12-20T08:00:00.000Z"); // round-trips

      for (const [label, value] of [["Délai de grâce (jours)", "3"], ["Conservation max. (jours)", "60"]] as const) {
        await user.clear(screen.getByLabelText(label));
        await user.type(screen.getByLabelText(label), value);
      }
      await user.clear(screen.getByLabelText("Date de fin de la sortie"));
      await user.type(screen.getByLabelText("Date de fin de la sortie"), "2030-02-01");
      await user.clear(screen.getByLabelText("Points pour la place 1"));
      await user.type(screen.getByLabelText("Points pour la place 1"), "8");
      await user.click(screen.getByRole("button", { name: "− retirer la dernière" }));
      await user.click(screen.getByRole("button", { name: "Enregistrer les paramètres" }));

      expect(await screen.findByText("Enregistré.")).toBeInTheDocument();
      expect(api.patches).toEqual([{
        graceDays: 3, maxRetentionDays: 60, tripEndDate: "2030-02-01",
        pointsTable: [{ placement: 1, points: 8 }],
      }]);
    });

    it("says when there is nothing to save", async () => {
      adminApi();
      const { user } = renderAt("/teacher/trips/t1/settings");
      await user.click(await screen.findByRole("button", { name: "Enregistrer les paramètres" }));
      expect(screen.getByText("Aucune modification.")).toBeInTheDocument();
    });

    it("locks team size once teams are formed, and points once results are computed", async () => {
      adminApi({ phase: "reveal" });
      renderAt("/teacher/trips/t1/settings");
      expect(await screen.findByLabelText(/Taille max. d'une équipe \(verrouillée/)).toBeDisabled();
      expect(screen.getByText(/Barème des points \(verrouillé/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "+ place" })).not.toBeInTheDocument();
    });

    it("is gone once the trip is erased, along with the erase control", async () => {
      adminApi({ phase: "erased" });
      renderAt("/teacher/trips/t1/settings");
      await screen.findByRole("heading", { name: "Enseignants" });
      expect(screen.queryByRole("heading", { name: "Paramètres" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Effacer/ })).not.toBeInTheDocument();
    });

    it("explains a phase-locked save", async () => {
      // The UI never offers a locked field, but a stale screen (phase moved underneath) can still send one.
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/settings");
      await user.type(await screen.findByLabelText("Taille max. d'une équipe"), "0");
      api.trip.phase = "challenge";
      await user.click(screen.getByRole("button", { name: "Enregistrer les paramètres" }));
      expect(await screen.findByText("Certains champs ne sont pas modifiables dans cette phase.")).toBeInTheDocument();
    });

    it("erases only once the trip's name is typed to confirm", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/settings");
      const danger = await waitFor(() => card("Zone de danger"));
      await user.click(within(danger).getByRole("button", { name: "Effacer toutes les données des élèves…" }));
      let dialog = screen.getByRole("alertdialog", { name: "Effacer toutes les données des élèves ?" });
      await user.click(within(dialog).getByRole("button", { name: "Annuler" }));
      expect(api.calls).not.toContain("erase");

      await user.click(within(danger).getByRole("button", { name: "Effacer toutes les données des élèves…" }));
      dialog = screen.getByRole("alertdialog", { name: "Effacer toutes les données des élèves ?" });
      const erase = within(dialog).getByRole("button", { name: "Effacer maintenant" });
      expect(erase).toBeDisabled();
      await user.type(within(dialog).getByLabelText(/Tape « Rome 2030 » pour confirmer/), "Rome 2030");
      await user.click(erase);
      await waitFor(() => expect(api.calls).toContain("erase"));
      expect(await screen.findByText(/Données des élèves effacées/)).toBeInTheDocument();
    });

    // #68: a failed erase used to look like nothing happened.
    it("says a failed erase will retry, and the header shows it's pending", async () => {
      const api = adminApi({ phase: "voting" });
      api.eraseFails = true;
      const { user } = renderAt("/teacher/trips/t1/settings");
      const danger = await waitFor(() => card("Zone de danger"));
      expect(screen.queryByText("Effacement en attente")).not.toBeInTheDocument();
      await user.click(within(danger).getByRole("button", { name: "Effacer toutes les données des élèves…" }));
      const dialog = screen.getByRole("alertdialog", { name: "Effacer toutes les données des élèves ?" });
      await user.type(within(dialog).getByLabelText(/Tape « Rome 2030 » pour confirmer/), "Rome 2030");
      await user.click(within(dialog).getByRole("button", { name: "Effacer maintenant" }));
      expect(await within(danger).findByText(/will retry automatically/)).toBeInTheDocument();
      expect(await screen.findByText("Effacement en attente")).toBeInTheDocument();
    });
  });

  describe("students", () => {
    const list = () => screen.findByRole("list", { name: "Élèves" });
    const students = () => screen.getByRole("list", { name: "Élèves" });
    const row = (email: string) => within(students()).getByText(email).closest("li") as HTMLElement;

    it("shows each student's status and team, with a hint when they asked for a new code", async () => {
      adminApi();
      renderAt("/teacher/trips/t1/students");
      await list();
      expect(row("ana@school.test")).toHaveTextContent("Inscrit");
      expect(row("ana@school.test")).toHaveTextContent("Léa & Tom 4B");
      expect(row("ana@school.test")).toHaveTextContent("nouveau code demandé");
      expect(row("tom@school.test")).toHaveTextContent("Invité");
      expect(row("tom@school.test")).toHaveTextContent("sans équipe");
      expect(row("lea@shcool.test")).toHaveTextContent("Non distribué");
    });

    // #104: the teacher sees why, in words — not a mail-server code.
    it("says why a code wasn't delivered", async () => {
      adminApi();
      renderAt("/teacher/trips/t1/students");
      await list();
      expect(row("lea@shcool.test")).toHaveTextContent("adresse inexistante");
      expect(row("orphan@shcool.test")).toHaveTextContent("domaine introuvable");
      expect(row("lea@shcool.test")).not.toHaveTextContent("MAILBOX_NOT_FOUND");
      expect(row("tom@school.test")).not.toHaveTextContent("introuvable");
    });

    it("filters with chips kept in the URL, and searches by email", async () => {
      adminApi();
      const { user, location } = renderAt("/teacher/trips/t1/students");
      const chips = await screen.findByRole("group", { name: "Filtrer les élèves" });
      expect(within(chips).getByRole("button", { name: "Tous 4" })).toHaveAttribute("aria-pressed", "true");
      await user.click(within(chips).getByRole("button", { name: "Pas inscrits 3" }));
      expect(location()).toBe("/teacher/trips/t1/students?filter=not-joined");
      expect(within(await list()).getAllByRole("listitem")).toHaveLength(3);
      expect(within(students()).queryByText("ana@school.test")).not.toBeInTheDocument();

      await user.type(screen.getByRole("searchbox", { name: "Rechercher par e-mail" }), "shcool");
      expect(within(await list()).getAllByRole("listitem")).toHaveLength(2);
      await user.type(screen.getByRole("searchbox", { name: "Rechercher par e-mail" }), "-nobody");
      expect(await screen.findByText("Personne ici")).toBeInTheDocument();
    });

    it("opens straight on a filter from a link", async () => {
      adminApi();
      renderAt("/teacher/trips/t1/students?filter=undelivered");
      expect(within(await list()).getAllByRole("listitem")).toHaveLength(2);
      expect(within(screen.getByRole("group", { name: "Filtrer les élèves" })).getByRole("button", { name: "Non distribués 2" }))
        .toHaveAttribute("aria-pressed", "true");
    });

    it("resends a code to a student who hasn't joined, and says why it failed when it does", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/students");
      await list();
      expect(within(row("ana@school.test")).queryByRole("button", { name: "Renvoyer le code" })).not.toBeInTheDocument();
      await user.click(within(row("tom@school.test")).getByRole("button", { name: "Renvoyer le code" }));
      expect(await within(row("tom@school.test")).findByRole("status")).toHaveTextContent("Code envoyé");
      expect(api.calls).toContain("resend s2");

      api.resendFails = true;
      await user.click(within(row("lea@shcool.test")).getByRole("button", { name: "Renvoyer le code" }));
      expect(await within(row("lea@shcool.test")).findByRole("alert")).toHaveTextContent("couldn't be sent");
    });

    it("fixes an undelivered address and sends the code to the new one", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/students");
      await list();
      await user.click(within(row("lea@shcool.test")).getByRole("button", { name: "Corriger l'adresse" }));
      const field = screen.getByLabelText("Adresse corrigée pour lea@shcool.test");
      expect(field).toHaveValue("lea@shcool.test");
      await user.clear(field);
      await user.type(field, "lea@school.test");
      await user.click(screen.getByRole("button", { name: "Enregistrer et envoyer" }));
      expect(await within(students()).findByText("lea@school.test")).toBeInTheDocument();
      expect(row("lea@school.test")).toHaveTextContent("Invité");
      expect(api.calls).toContain("fix s3 lea@school.test");
    });

    it("retries an address that never became a student, corrected", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/students");
      await list();
      await user.click(within(row("orphan@shcool.test")).getByRole("button", { name: "Corriger l'adresse" }));
      const field = screen.getByLabelText("Adresse corrigée pour orphan@shcool.test");
      await user.clear(field);
      await user.type(field, "orphan@school.test");
      await user.click(screen.getByRole("button", { name: "Enregistrer et envoyer" }));
      expect(await within(students()).findByText("orphan@school.test")).toBeInTheDocument();
      expect(row("orphan@school.test")).toHaveTextContent("Envoi");
      expect(api.calls).toContain("retry i1 orphan@school.test");
    });

    describe("teams", () => {
      const team = () => screen.findByRole("article", { name: /Léa & Tom 4B|Les Renards/ });

      it("shows members, size and activity, and why names need a look", async () => {
        adminApi();
        renderAt("/teacher/trips/t1/students");
        const t = await team();
        expect(t).toHaveTextContent("ana@school.test");
        expect(t).toHaveTextContent("1/4");
        expect(t).toHaveTextContent("2 photos");
        expect(t).toHaveTextContent("Non vérifié");
        expect(card("Équipes")).toHaveTextContent("deviennent « Équipe 1 »");
      });

      it("marks a name OK, or renames it (which also counts as checked)", async () => {
        const api = adminApi();
        const { user } = renderAt("/teacher/trips/t1/students");
        await user.click(within(await team()).getByRole("button", { name: "Nom OK" }));
        expect(await within(await team()).findByText("Vérifié")).toBeInTheDocument();
        expect(api.calls).toContain("review team1");

        await user.click(within(await team()).getByRole("button", { name: "Renommer" }));
        const field = screen.getByLabelText("Nouveau nom pour Léa & Tom 4B");
        await user.clear(field);
        await user.type(field, "Les Renards");
        await user.click(screen.getByRole("button", { name: "Enregistrer le nom" }));
        expect(await screen.findByRole("article", { name: "Les Renards" })).toBeInTheDocument();
        expect(api.calls).toContain("rename team1 Les Renards");
      });

      it("names are final from the reveal on", async () => {
        adminApi({ phase: "reveal" });
        renderAt("/teacher/trips/t1/students");
        const t = await team();
        expect(within(t).queryByRole("button", { name: "Renommer" })).not.toBeInTheDocument();
        expect(within(t).queryByRole("button", { name: "Nom OK" })).not.toBeInTheDocument();
        expect(card("Équipes")).toHaveTextContent("Les noms sont définitifs");
      });
    });

    it("imports pasted emails and reports progress", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/students");
      const box = await screen.findByLabelText(/E-mails des élèves/);
      await user.type(box, "a@school.test, b@school.test\nc@school.test");
      await user.click(screen.getByRole("button", { name: "Importer et envoyer les codes" }));
      expect(await screen.findByText(/3 sur 3 en file d'attente/)).toBeInTheDocument();
      expect(api.calls).toContain("roster a@school.test,b@school.test,c@school.test");
      expect(box).toHaveValue("");
    });

    it("follows an import until every code is out", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const api = adminApi();
      api.roster = { pending: 0, done: 0, failed: 0, students: 0 };
      const { user } = renderAt("/teacher/trips/t1/students");
      await user.type(await screen.findByLabelText(/E-mails des élèves/), "a@school.test, b@school.test");
      await user.click(screen.getByRole("button", { name: "Importer et envoyer les codes" }));
      await screen.findByText(/2 sur 2 en file d'attente/);

      api.roster = { pending: 1, done: 1, failed: 0, students: 2 };
      await act(() => vi.advanceTimersByTimeAsync(2100));
      expect(await screen.findByText("1 codes envoyés sur 2 — envoi…")).toBeInTheDocument();

      api.roster = { pending: 0, done: 2, failed: 0, students: 2 };
      await act(() => vi.advanceTimersByTimeAsync(2100));
      expect(await screen.findByText("2 codes envoyés sur 2")).toBeInTheDocument();
    });

    it("lists the students without a team", async () => {
      adminApi();
      const { user } = renderAt("/teacher/trips/t1/students");
      const chips = await screen.findByRole("group", { name: "Filtrer les élèves" });
      await user.click(within(chips).getByRole("button", { name: /^Sans équipe/ }));
      const items = within(await list()).getAllByRole("listitem");
      expect(items.length).toBeGreaterThan(0);
      expect(within(students()).queryByText("ana@school.test")).not.toBeInTheDocument(); // in a team
      expect(within(students()).getByText("tom@school.test")).toBeInTheDocument();
    });

    it("cancels a correction or a rename without sending anything", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/students");
      await list();
      await user.click(within(row("lea@shcool.test")).getByRole("button", { name: "Corriger l'adresse" }));
      await user.click(within(row("lea@shcool.test")).getByRole("button", { name: "Annuler" }));
      expect(screen.queryByLabelText("Adresse corrigée pour lea@shcool.test")).not.toBeInTheDocument();

      const t = await screen.findByRole("article", { name: "Léa & Tom 4B" });
      await user.click(within(t).getByRole("button", { name: "Renommer" }));
      await user.click(within(t).getByRole("button", { name: "Annuler" }));
      expect(screen.queryByLabelText("Nouveau nom pour Léa & Tom 4B")).not.toBeInTheDocument();
      expect(api.calls.filter((c) => /^(fix|retry|rename) /.test(c))).toEqual([]);
    });

    it("offers the lost-code recovery link to copy", async () => {
      adminApi();
      renderAt("/teacher/trips/t1/students");
      expect(await screen.findByLabelText("Lien de récupération de code")).toHaveValue(`${location.origin}/join?trip=t1`);
      expect(screen.getByRole("button", { name: "Copier" })).toBeInTheDocument();
    });

    it("tells the teacher when an import is refused", async () => {
      const api = adminApi();
      api.rosterRefusal = true;
      const { user } = renderAt("/teacher/trips/t1/students");
      await user.type(await screen.findByLabelText(/E-mails des élèves/), "not-an-email");
      await user.click(screen.getByRole("button", { name: "Importer et envoyer les codes" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("invalid email");
      expect(screen.getByLabelText(/E-mails des élèves/)).toHaveValue("not-an-email");
    });

    it("can't import an empty list", async () => {
      adminApi();
      renderAt("/teacher/trips/t1/students");
      expect(await screen.findByRole("button", { name: "Importer et envoyer les codes" })).toBeDisabled();
    });

    it("shows how far the access codes have gone out", async () => {
      const api = adminApi();
      api.roster = { pending: 1, done: 2, failed: 0, students: 3 };
      renderAt("/teacher/trips/t1/students");
      const bar = await screen.findByRole("progressbar", { name: "Codes envoyés" });
      expect(bar).toHaveAttribute("aria-valuenow", "2");
      expect(bar).toHaveAttribute("aria-valuemax", "3");
      expect(screen.getByText(/2 codes envoyés sur 3 — envoi/)).toBeInTheDocument();
    });

    it("flags emails that couldn't be sent", async () => {
      const api = adminApi();
      api.roster = { pending: 0, done: 2, failed: 1, students: 3 };
      renderAt("/teacher/trips/t1/students");
      expect(await screen.findByText(/1 e-mail en échec/)).toBeInTheDocument();
    });
  });

  describe("challenges", () => {
    it("adds, edits and (in draft) deletes challenges after confirming", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/challenges");
      const ch = await waitFor(() => card("Défis"));
      expect(await within(ch).findByText("Gelato selfie")).toBeInTheDocument();
      expect(within(ch).getByText("×2")).toBeInTheDocument();
      expect(within(ch).getByAltText("QR code du défi Gelato selfie")).toHaveAttribute("src", "/api/challenges/ch1/qr.png");

      const add = card("Nouveau défi");
      await user.type(within(add).getByLabelText("Titre"), " Fountain ");
      await user.type(within(add).getByLabelText("Consignes"), "Throw a coin{enter}Make a wish");
      await user.click(within(add).getByRole("button", { name: "Ajouter le défi" }));
      expect(await within(ch).findByText("Fountain")).toBeInTheDocument();
      expect(within(add).getByLabelText("Titre")).toHaveValue("");

      await user.click(within(ch).getAllByRole("button", { name: "Modifier" })[0]!);
      const title = within(ch).getByLabelText("Titre");
      await user.clear(title);
      await user.type(title, "Gelato duo");
      await user.click(within(ch).getByRole("button", { name: "Enregistrer" }));
      expect(await within(ch).findByText("Gelato duo")).toBeInTheDocument();

      await user.click(within(ch).getAllByRole("button", { name: "Supprimer" })[1]!);
      const dialog = screen.getByRole("alertdialog", { name: "Supprimer « Fountain » ?" });
      expect(dialog).toHaveTextContent("Son QR code ne fonctionnera plus.");
      await user.click(within(dialog).getByRole("button", { name: "Supprimer" }));
      await waitFor(() => expect(within(ch).queryByText("Fountain")).not.toBeInTheDocument());
      expect(api.calls).toEqual([
        `create {"tripId":"t1","title":"Fountain","instructions":"Throw a coin\\nMake a wish","multiplier":1}`,
        `edit ch1 {"title":"Gelato duo","instructions":"With a gelato","multiplier":2}`,
        "delete ch2",
      ]);
    });

    it("explains a challenge that can't be added, and keeps what was typed", async () => {
      adminApi();
      const { user } = renderAt("/teacher/trips/t1/challenges");
      const add = await waitFor(() => card("Nouveau défi"));
      await user.type(within(add).getByLabelText("Titre"), "Refused");
      await user.click(within(add).getByRole("button", { name: "Ajouter le défi" }));
      expect(await within(add).findByRole("alert")).toHaveTextContent("multiplier must be positive");
      expect(within(add).getByLabelText("Titre")).toHaveValue("Refused");
    });

    it("shows an empty state before the first challenge", async () => {
      const api = adminApi();
      api.challenges = [];
      renderAt("/teacher/trips/t1/challenges");
      expect(await screen.findByText("Pas encore de défi")).toBeInTheDocument();
    });

    it("stops adding at voting, editing at reveal, and deleting after draft", async () => {
      adminApi({ phase: "voting" });
      renderAt("/teacher/trips/t1/challenges");
      const ch = await waitFor(() => card("Défis"));
      await within(ch).findByText("Gelato selfie");
      expect(screen.queryByRole("heading", { name: "Nouveau défi" })).not.toBeInTheDocument();
      expect(within(ch).getByRole("button", { name: "Modifier" })).toBeInTheDocument();
      expect(within(ch).queryByRole("button", { name: "Supprimer" })).not.toBeInTheDocument();
    });

    it("opens a printable sheet of the QR codes", async () => {
      adminApi();
      renderAt("/teacher/trips/t1/challenges");
      const print = await screen.findByRole("link", { name: "Imprimer les QR codes" });
      expect(print).toHaveAttribute("href", "/qr/t1");
      expect(print).toHaveAttribute("target", "_blank");
    });
  });

  describe("QR sheet", () => {
    it("lays out one cut-out card per challenge and prints", async () => {
      const api = adminApi();
      api.challenges.push({ id: "ch2", title: "Fountain", instructions: "Throw a coin", multiplier: 1, qr_slug: "def" });
      const print = vi.spyOn(window, "print").mockImplementation(() => {});
      const { user } = renderAt("/qr/t1");
      expect(await screen.findByRole("heading", { name: "Rome 2030 — QR codes" })).toBeInTheDocument();
      const cards = await screen.findAllByRole("article");
      expect(cards).toHaveLength(2);
      expect(within(cards[0]!).getByRole("heading", { name: "Gelato selfie" })).toBeInTheDocument();
      expect(within(cards[0]!).getByText("×2 points")).toBeInTheDocument();
      expect(within(cards[1]!).getByText("Throw a coin")).toBeInTheDocument();
      expect(within(cards[1]!).getByRole("img", { name: "QR code du défi Fountain" })).toHaveAttribute("src", "/api/challenges/ch2/qr.png");
      await user.click(screen.getByRole("button", { name: "Imprimer" }));
      expect(print).toHaveBeenCalled();
    });

    it("says so when the trip can't be loaded", async () => {
      server.use(http.get("/api/trips/zzz", () => HttpResponse.json({}, { status: 404 })));
      renderAt("/qr/zzz");
      expect(await screen.findByText("Sortie introuvable.")).toBeInTheDocument();
    });
  });

  // #69: none of these may turn an outage into "nothing here".
  describe("when a section's data fails to load", () => {
    it("review says so instead of “Nothing to review”", async () => {
      adminApi();
      server.use(http.get("/api/nominations/trip/t1", () => down("r-noms")));
      renderAt("/teacher/trips/t1/review");
      expect((await screen.findAllByText("The database is unavailable right now.")).length).toBeGreaterThan(0);
      expect(screen.queryByText("Rien à modérer")).not.toBeInTheDocument();
    });

    it("results say so instead of an empty board", async () => {
      adminApi({ phase: "reveal" });
      server.use(http.get("/api/trips/t1/results", () => down("r-res")));
      renderAt("/teacher/trips/t1/results");
      expect(await screen.findByText("The database is unavailable right now.")).toBeInTheDocument();
      expect(screen.getByText(/^Référence :/)).toHaveTextContent("r-res");
    });

    it("the overview says so instead of planning from a missing roster", async () => {
      adminApi();
      server.use(http.get("/api/trips/t1/roster/status", () => down("r-roster")));
      renderAt("/teacher/trips/t1/overview");
      expect(await screen.findByText("The database is unavailable right now.")).toBeInTheDocument();
      expect(screen.queryByText("Colle les e-mails des élèves")).not.toBeInTheDocument();
    });

    it("teams say so", async () => {
      adminApi();
      server.use(http.get("/api/trips/t1/teams", () => down("r-teams")));
      renderAt("/teacher/trips/t1/students");
      expect(await screen.findByText("The database is unavailable right now.")).toBeInTheDocument();
    });

    it("pending invites say so", async () => {
      adminApi();
      server.use(http.get("/api/trips/t1/invites", () => down("r-inv")));
      renderAt("/teacher/trips/t1/settings");
      expect(await screen.findByText("The database is unavailable right now.")).toBeInTheDocument();
    });
  });

  describe("review", () => {
    const queue = () => screen.getByRole("region", { name: "En attente de modération" });
    /** The queue once the trip (and so the section) has loaded. */
    const loaded = () => screen.findByRole("region", { name: "En attente de modération" });

    it("groups what waits for review by challenge", async () => {
      const api = adminApi();
      api.challenges.push({ id: "ch2", title: "Fountain", instructions: "", multiplier: 1, qr_slug: "def" });
      api.nominations.push({ id: "n2", challenge_id: "ch2", team_id: "team2", submission_id: "sub2", state: "pending" });
      renderAt("/teacher/trips/t1/review");
      const gelato = await screen.findByRole("group", { name: "Gelato selfie" });
      const fountain = screen.getByRole("group", { name: "Fountain" });
      expect(within(gelato).getAllByRole("button", { name: "Valider" })).toHaveLength(1);
      expect(within(fountain).getByRole("button", { name: "Agrandir la photo" }).querySelector("img")).toHaveAttribute("src", "/api/submissions/sub2/photo");
      expect(within(queue()).getByText("2 en attente")).toBeInTheDocument();
    });

    it.each([
      ["Valider", "approve n1"],
      ["Refuser", "reject n1"],
    ])("%s takes the nomination off the queue and the nav badge", async (button, call) => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/review");
      expect(await screen.findByRole("link", { name: "Modération, 1 en attente" })).toBeInTheDocument();
      await user.click(await within(await loaded()).findByRole("button", { name: button }));
      expect(await within(queue()).findByText("Rien à modérer")).toBeInTheDocument();
      expect(await within(nav()).findByRole("link", { name: "Modération" })).toBeInTheDocument();
      expect(api.calls).toEqual([call]);
    });

    // #81 (owner decision): rejecting after voting opened is allowed, with a warning.
    it("warns before rejecting once voting has opened: the team can't replace its entry", async () => {
      const api = adminApi({ phase: "voting" });
      const { user } = renderAt("/teacher/trips/t1/review");
      await user.click(await within(await loaded()).findByRole("button", { name: "Refuser" }));
      let dialog = screen.getByRole("alertdialog", { name: "Refuser cette photo ?" });
      expect(dialog).toHaveTextContent(/ne peut plus sélectionner d'autre photo/);
      await user.click(within(dialog).getByRole("button", { name: "Annuler" }));
      expect(api.calls).toEqual([]);

      await user.click(within(queue()).getByRole("button", { name: "Refuser" }));
      dialog = screen.getByRole("alertdialog", { name: "Refuser cette photo ?" });
      await user.click(within(dialog).getByRole("button", { name: "Refuser" }));
      await waitFor(() => expect(api.calls).toEqual(["reject n1"]));
    });

    it("lists approved photos, which can still be removed", async () => {
      adminApi();
      const { user } = renderAt("/teacher/trips/t1/review");
      await user.click(await within(await loaded()).findByRole("button", { name: "Valider" }));
      const approved = await screen.findByRole("region", { name: "Validées — ouvertes au vote" });
      expect(await within(approved).findByRole("button", { name: "Retirer la photo…" })).toBeInTheDocument();
    });

    it("removes a photo only after confirming", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/review");
      await user.click(await within(await loaded()).findByRole("button", { name: "Retirer la photo…" }));
      const dialog = screen.getByRole("alertdialog", { name: "Retirer cette photo ?" });
      expect(dialog).toHaveTextContent("Plus personne ne la verra");
      await user.click(within(dialog).getByRole("button", { name: "Annuler" }));
      expect(api.calls).toEqual([]);

      await user.click(within(queue()).getByRole("button", { name: "Retirer la photo…" }));
      await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Retirer la photo" }));
      expect(await within(queue()).findByText("Rien à modérer")).toBeInTheDocument();
      expect(api.calls).toEqual(["remove sub1"]);
    });

    it("a decision takes the photo off the queue and the badge at once, before the server answers", async () => {
      adminApi();
      const { user } = renderAt("/teacher/trips/t1/review");
      const approve = await within(await loaded()).findByRole("button", { name: "Valider" });
      server.use(http.post("/api/nominations/:id/:decision", async () => { await delay(400); return HttpResponse.json({ ok: true }); }));
      await user.click(approve);
      expect(within(queue()).queryByRole("button", { name: "Valider" })).not.toBeInTheDocument();
      expect(within(nav()).getByRole("link", { name: "Modération" })).toBeInTheDocument();
    });

    it("explains a refused decision and keeps the nomination", async () => {
      const api = adminApi();
      api.moderationRefusal = "Moderation is closed in this phase.";
      const { user } = renderAt("/teacher/trips/t1/review");
      await user.click(await within(await loaded()).findByRole("button", { name: "Valider" }));
      expect(await within(queue()).findByRole("alert")).toHaveTextContent("Moderation is closed in this phase.");
      expect(within(queue()).getByRole("button", { name: "Valider" })).toBeEnabled();
    });

    it("enlarges a photo from the keyboard", async () => {
      adminApi();
      const { user } = renderAt("/teacher/trips/t1/review");
      const enlarge = await within(await loaded()).findByRole("button", { name: "Agrandir la photo" });
      enlarge.focus();
      await user.keyboard("{Enter}");
      const dialog = screen.getByRole("dialog", { name: "Photo" });
      expect(within(dialog).getByAltText("Gelato selfie")).toHaveAttribute("src", "/api/submissions/sub1/photo");
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("co-teachers", () => {
    it.each([
      ["new@school.test", "Invitation envoyée à new@school.test."],
      ["owner@school.test", "Déjà enseignant sur cette sortie."],
      ["nope@school.test", "Seul le responsable de la sortie peut inviter des co-enseignants."],
    ])("inviting %s → “%s”", async (email, message) => {
      adminApi();
      const { user } = renderAt("/teacher/trips/t1/settings");
      await user.type(await screen.findByLabelText("Inviter un co-enseignant par e-mail"), email);
      await user.click(screen.getByRole("button", { name: "Envoyer l'invitation" }));
      expect(await screen.findByText(message)).toBeInTheDocument();
    });

    it("revokes a pending invite", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/settings");
      await user.click(await screen.findByRole("button", { name: "Révoquer" }));
      await waitFor(() => expect(screen.queryByText("pending@school.test")).not.toBeInTheDocument());
      expect(api.calls).toEqual(["revoke inv1"]);
    });

    it("explains a refused revoke and keeps the invite", async () => {
      const api = adminApi();
      api.revokeRefusal = true;
      const { user } = renderAt("/teacher/trips/t1/settings");
      await user.click(await screen.findByRole("button", { name: "Révoquer" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Only the trip owner can revoke invites.");
      expect(screen.getByText("pending@school.test")).toBeInTheDocument();
    });
  });

  describe("results", () => {
    const results = [
      { id: "r1", challenge_title: "Gelato selfie", placement: 1, team_name_vetted: "Foxes", points: 10, is_grand_champion: false },
      { id: "g1", challenge_title: "", placement: 1, team_name_vetted: "Foxes", points: 10, is_grand_champion: true },
      { id: "g2", challenge_title: "", placement: 1, team_name_vetted: "Owls", points: 10, is_grand_champion: true },
    ];

    it("stay hidden before the reveal, even by direct link", async () => {
      adminApi({ phase: "voting" });
      const { location } = renderAt("/teacher/trips/t1/results");
      await waitFor(() => expect(location()).toBe("/teacher/trips/t1/overview"));
      expect(screen.queryByRole("heading", { name: "Résultats et cérémonie" })).not.toBeInTheDocument();
    });

    it("let the teacher break a Grand Champion tie and launch the ceremony", async () => {
      const api = adminApi({ phase: "reveal" });
      api.results = [...results];
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      const { user } = renderAt("/teacher/trips/t1/results");
      expect(await screen.findByText(/Égalité pour le titre de grand champion/)).toBeInTheDocument();
      await user.click(screen.getAllByRole("button", { name: "Couronner cette équipe" })[1]!);
      await waitFor(() => expect(screen.queryByText(/Égalité/)).not.toBeInTheDocument());
      expect(api.calls).toEqual(["crown g2"]);

      await user.click(screen.getByRole("button", { name: "🏆 Lancer la cérémonie" }));
      expect(open).toHaveBeenCalledWith("/ceremony/t1", "_blank", "noopener");
    });

    it("explains a crown that was refused", async () => {
      const api = adminApi({ phase: "reveal" });
      api.results = [...results];
      api.crownRefusal = true;
      const { user } = renderAt("/teacher/trips/t1/results");
      await user.click((await screen.findAllByRole("button", { name: "Couronner cette équipe" }))[0]!);
      expect(await screen.findByRole("alert")).toHaveTextContent("The ceremony is over.");
    });

    it("says when there are no results", async () => {
      adminApi({ phase: "grace" });
      renderAt("/teacher/trips/t1/results");
      expect(await screen.findByText("Aucun résultat")).toBeInTheDocument();
    });
  });
});
