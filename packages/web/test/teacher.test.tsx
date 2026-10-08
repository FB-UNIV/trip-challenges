// Teacher UI: sign-in gate, trip list/creation, and the trip admin screen.
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "./server.js";
import { renderAt } from "./render.js";

const TEACHER = { id: "tch1", email: "owner@school.test", display_name: "Owner" };

describe("teacher home", () => {
  it("asks a signed-out teacher to sign in", async () => {
    server.use(
      http.get("/api/auth/teacher/me", () => HttpResponse.json({}, { status: 401 })),
      http.get("/api/trips", () => HttpResponse.json({}, { status: 401 })),
    );
    renderAt("/teacher");
    expect(await screen.findByRole("button", { name: "Sign in with PocketID" })).toBeInTheDocument();
  });

  it("lists the teacher's trips and creates a new one", async () => {
    const trips = [{ id: "t1", name: "Rome 2030", phase: "challenge", role: "owner", trip_end_date: "2030-01-01" }];
    let created: unknown;
    server.use(
      http.get("/api/auth/teacher/me", () => HttpResponse.json(TEACHER)),
      http.get("/api/trips", () => HttpResponse.json({ trips })),
      http.post("/api/trips", async ({ request }) => {
        created = await request.json();
        trips.push({ id: "t2", name: "Paris 2031", phase: "draft", role: "owner", trip_end_date: "2031-01-01" });
        return HttpResponse.json({ id: "t2" }, { status: 201 });
      }),
    );
    const { user } = renderAt("/teacher");
    expect(await screen.findByRole("link", { name: /Rome 2030/ })).toHaveAttribute("href", "/teacher/trips/t1");

    const create = screen.getByRole("button", { name: "Create trip" });
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText("Name"), " Paris 2031 ");
    await user.type(screen.getByLabelText("Trip end date"), "2031-01-01");
    await user.clear(screen.getByLabelText("Max team size"));
    await user.type(screen.getByLabelText("Max team size"), "5");
    await user.click(create);

    expect(await screen.findByRole("link", { name: /Paris 2031/ })).toBeInTheDocument();
    expect(created).toEqual({ name: "Paris 2031", tripEndDate: "2031-01-01", maxTeamSize: 5 });
  });

  it("tells the teacher when a trip can't be created", async () => {
    server.use(
      http.get("/api/auth/teacher/me", () => HttpResponse.json(TEACHER)),
      http.get("/api/trips", () => HttpResponse.json({ trips: [] })),
      http.post("/api/trips", () => HttpResponse.json({ error: "bad_request", message: "maxTeamSize too big" }, { status: 400 })),
    );
    const { user } = renderAt("/teacher");
    await user.type(await screen.findByLabelText("Name"), "Paris");
    await user.type(screen.getByLabelText("Trip end date"), "2031-01-01");
    await user.click(screen.getByRole("button", { name: "Create trip" }));
    expect(await screen.findByText(/Could not create the trip/)).toBeInTheDocument();
  });
});

type Trip = {
  id: string; name: string; phase: string; max_team_size: number; grace_days: number; max_retention_days: number;
  trip_end_date: string; points_table: { placement: number; points: number }[];
  challenge_opens_at: string | null; voting_opens_at: string | null; voting_closes_at: string | null;
};

/** A stateful fake of every endpoint the trip admin screen uses. */
function adminApi(over: Partial<Trip> = {}) {
  const s = {
    trip: {
      id: "t1", name: "Rome 2030", phase: "draft", max_team_size: 4, grace_days: 7, max_retention_days: 30,
      trip_end_date: "2030-01-01T00:00:00.000Z", points_table: [{ placement: 1, points: 5 }, { placement: 2, points: 3 }],
      challenge_opens_at: null, voting_opens_at: null, voting_closes_at: null, ...over,
    } as Trip,
    roster: { pending: 0, done: 3, failed: 0, students: 3 },
    challenges: [{ id: "ch1", title: "Gelato selfie", instructions: "With a gelato", multiplier: 2, qr_slug: "abc" }],
    nominations: [{ id: "n1", challenge_id: "ch1", team_id: "team1", submission_id: "sub1", state: "pending" }],
    teachers: [{ id: "tch1", email: "owner@school.test", display_name: "Owner", role: "owner" }],
    invites: [{ id: "inv1", email: "pending@school.test", expires_at: "2030-01-08" }],
    results: [] as object[],
    progress: {
      students: 3, teams: 1, studentsWithoutTeam: 1, eraseAt: "2030-02-01T00:00:00.000Z", graceEndsAt: null,
      challenges: [{ id: "ch1", title: "Gelato selfie", teamsWithPhotos: 0, pending: 1, approved: 0, rejected: 0 }],
    },
    calls: [] as string[],
    patches: [] as unknown[],
    advanceRefusal: null as string | null,
    rosterRefusal: false,
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
    http.post("/api/trips/t1/erase", () => ok("erase")),
    http.get("/api/trips/t1/roster/status", () => HttpResponse.json(s.roster)),
    http.get("/api/trips/t1/progress", () => HttpResponse.json(s.progress)),
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
      expect(new URL(request.url).searchParams.get("state")).toBe("pending");
      return HttpResponse.json({ nominations: s.nominations });
    }),
    http.post("/api/nominations/:id/:decision", ({ params }) => {
      s.nominations = s.nominations.filter((n) => n.id !== params.id);
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
      s.invites = s.invites.filter((i) => i.id !== params.inviteId);
      return ok(`revoke ${params.inviteId}`);
    }),
    http.get("/api/trips/t1/results", () => HttpResponse.json({ results: s.results })),
    http.post("/api/trips/t1/grand-champion", async ({ request }) => {
      const { resultId } = (await request.json()) as { resultId: string };
      s.results = s.results.filter((r: any) => !r.is_grand_champion || r.id === resultId);
      return ok(`crown ${resultId}`);
    }),
  );
  return s;
}

const card = (heading: string) => screen.getByRole("heading", { name: heading }).closest(".card") as HTMLElement;
const nav = () => screen.getByRole("navigation", { name: "Trip sections" });

describe("trip admin", () => {
  describe("layout", () => {
    it("lands on the overview with a section nav; Review shows what's pending", async () => {
      adminApi();
      const { location } = renderAt("/teacher/trips/t1");
      expect(await screen.findByRole("heading", { name: "Rome 2030" })).toBeInTheDocument();
      await waitFor(() => expect(location()).toBe("/teacher/trips/t1/overview"));
      expect(within(nav()).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
      for (const [label, path] of [["Challenges", "challenges"], ["Students", "students"], ["Settings", "settings"]]) {
        expect(within(nav()).getByRole("link", { name: label })).toHaveAttribute("href", `/teacher/trips/t1/${path}`);
      }
      expect(await within(nav()).findByRole("link", { name: "Review, 1 pending" })).toHaveAttribute("href", "/teacher/trips/t1/review");
      expect(within(nav()).queryByRole("link", { name: "Results" })).not.toBeInTheDocument();
    });

    it("lands on the results during the reveal", async () => {
      adminApi({ phase: "reveal" });
      const { location } = renderAt("/teacher/trips/t1");
      await waitFor(() => expect(location()).toBe("/teacher/trips/t1/results"));
      expect(await screen.findByRole("heading", { name: "Results & ceremony" })).toBeInTheDocument();
      expect(within(nav()).getByRole("link", { name: "Results" })).toHaveAttribute("aria-current", "page");
    });

    it("says so for a trip it can't load", async () => {
      server.use(http.get("/api/trips/zzz", () => HttpResponse.json({}, { status: 404 })));
      renderAt("/teacher/trips/zzz");
      expect(await screen.findByText("Not found.")).toBeInTheDocument();
    });
  });

  describe("overview", () => {
    it("summarises the trip; the review tile is flagged and opens the review", async () => {
      adminApi();
      const { user, location } = renderAt("/teacher/trips/t1/overview");
      const tile = (k: string) => [...document.querySelectorAll(".tile")].find((t) => t.querySelector(".k")?.textContent === k)!;
      await waitFor(() => expect(tile("Students")).toHaveTextContent("3"));
      expect(tile("Teams")).toHaveTextContent("1");
      expect(tile("Challenges")).toHaveTextContent("1");
      await waitFor(() => expect(tile("To review")).toHaveTextContent("1"));
      expect(tile("To review")).toHaveClass("flag");
      await user.click(screen.getByRole("link", { name: /To review/ }));
      expect(location()).toBe("/teacher/trips/t1/review");
    });

    it("lists what's ready and what's missing, each linking to where it's done", async () => {
      adminApi();
      renderAt("/teacher/trips/t1/overview");
      const now = await waitFor(() => card("Getting ready"));
      expect(await within(now).findByRole("link", { name: /Import the roster/ })).toHaveAttribute("href", "/teacher/trips/t1/students");
      expect(within(now).getByRole("link", { name: /Add challenges/ })).toHaveTextContent("1 challenge");
      expect(within(now).getByRole("link", { name: /Students form teams/ })).toHaveTextContent("1 without a team");
      expect(within(now).getByRole("link", { name: /Plan the dates/ })).toHaveAttribute("href", "/teacher/trips/t1/settings");
    });

    it("warns when student data is about to be erased", async () => {
      const api = adminApi({ phase: "voting" });
      api.progress.eraseAt = new Date(Date.now() + 2.2 * 86_400_000).toISOString();
      renderAt("/teacher/trips/t1/overview");
      expect(await screen.findByText("Student data will be erased in 2 days.")).toBeInTheDocument();
    });

    it("keeps erasure away from the everyday controls", async () => {
      adminApi();
      renderAt("/teacher/trips/t1/overview");
      await screen.findByRole("heading", { name: "Getting ready" });
      expect(screen.queryByRole("button", { name: /Erase/ })).not.toBeInTheDocument();
    });
  });

  describe("lifecycle", () => {
    it("moves the trip on after confirming what that does", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/overview");
      await user.click(await screen.findByRole("button", { name: "Start the challenge →" }));
      const dialog = screen.getByRole("alertdialog", { name: "Start the challenge?" });
      expect(dialog).toHaveTextContent("1 student has no team yet");
      await user.click(within(dialog).getByRole("button", { name: "Start the challenge" }));
      expect(await screen.findByRole("heading", { name: "Challenge under way" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open voting →" })).toBeInTheDocument();
      expect(api.calls).toContain("advance challenge");
    });

    it("does nothing when the teacher cancels", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/overview");
      await user.click(await screen.findByRole("button", { name: "Start the challenge →" }));
      await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
      expect(api.calls).not.toContain("advance challenge");
      expect(screen.getByRole("heading", { name: "Getting ready" })).toBeInTheDocument();
    });

    it("catches up when the trip already moved on (another teacher, or the planned date)", async () => {
      const api = adminApi();
      api.advanceRefusal = "challenge";
      const { user } = renderAt("/teacher/trips/t1/overview");
      await user.click(await screen.findByRole("button", { name: "Start the challenge →" }));
      await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Start the challenge" }));
      expect(await screen.findByRole("button", { name: "Open voting →" })).toBeInTheDocument();
    });

    it("explains an advance that failed for another reason", async () => {
      adminApi();
      server.use(http.post("/api/trips/t1/advance", () => HttpResponse.json({ error: "oops", message: "Vault is unreachable." }, { status: 503 })));
      const { user } = renderAt("/teacher/trips/t1/overview");
      await user.click(await screen.findByRole("button", { name: "Start the challenge →" }));
      await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Start the challenge" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Vault is unreachable.");
    });
  });

  describe("settings", () => {
    it("saves only what changed, with planned dates as instants, and keeps “Saved.” visible (#30)", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/settings");
      const name = await screen.findByLabelText("Trip name");
      await user.clear(name);
      await user.type(name, "Rome 2031");
      await user.type(screen.getByLabelText("Voting closes"), "2030-01-05T18:30");
      await user.click(screen.getByRole("button", { name: "+ placement" }));
      await user.click(screen.getByRole("button", { name: "Save settings" }));

      expect(await screen.findByText("Saved.")).toBeInTheDocument();
      expect(await screen.findByRole("heading", { name: "Rome 2031" })).toBeInTheDocument();
      expect(screen.getByText("Saved.")).toBeInTheDocument();
      expect(api.patches).toEqual([{
        name: "Rome 2031",
        votingClosesAt: new Date("2030-01-05T18:30").toISOString(),
        pointsTable: [{ placement: 1, points: 5 }, { placement: 2, points: 3 }, { placement: 3, points: 0 }],
      }]);
    });

    it("says when there is nothing to save", async () => {
      adminApi();
      const { user } = renderAt("/teacher/trips/t1/settings");
      await user.click(await screen.findByRole("button", { name: "Save settings" }));
      expect(screen.getByText("No changes.")).toBeInTheDocument();
    });

    it("locks team size once teams are formed, and points once results are computed", async () => {
      adminApi({ phase: "reveal" });
      renderAt("/teacher/trips/t1/settings");
      expect(await screen.findByLabelText(/Max team size \(locked/)).toBeDisabled();
      expect(screen.getByText(/Points table \(locked/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "+ placement" })).not.toBeInTheDocument();
    });

    it("is gone once the trip is erased, along with the erase control", async () => {
      adminApi({ phase: "erased" });
      renderAt("/teacher/trips/t1/settings");
      await screen.findByRole("heading", { name: "Teachers" });
      expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Erase/ })).not.toBeInTheDocument();
    });

    it("explains a phase-locked save", async () => {
      // The UI never offers a locked field, but a stale screen (phase moved underneath) can still send one.
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/settings");
      await user.type(await screen.findByLabelText("Max team size"), "0");
      api.trip.phase = "challenge";
      await user.click(screen.getByRole("button", { name: "Save settings" }));
      expect(await screen.findByText("Some fields aren't editable in this phase.")).toBeInTheDocument();
    });

    it("erases only once the trip's name is typed to confirm", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/settings");
      const danger = await waitFor(() => card("Danger zone"));
      await user.click(within(danger).getByRole("button", { name: "Erase all student data…" }));
      let dialog = screen.getByRole("alertdialog", { name: "Erase all student data?" });
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(api.calls).not.toContain("erase");

      await user.click(within(danger).getByRole("button", { name: "Erase all student data…" }));
      dialog = screen.getByRole("alertdialog", { name: "Erase all student data?" });
      const erase = within(dialog).getByRole("button", { name: "Erase now" });
      expect(erase).toBeDisabled();
      await user.type(within(dialog).getByLabelText(/Type “Rome 2030” to confirm/), "Rome 2030");
      await user.click(erase);
      await waitFor(() => expect(api.calls).toContain("erase"));
    });
  });

  describe("students", () => {
    it("imports pasted emails and reports progress", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/students");
      const box = await screen.findByLabelText(/Student emails/);
      await user.type(box, "a@school.test, b@school.test\nc@school.test");
      await user.click(screen.getByRole("button", { name: "Import + email codes" }));
      expect(await screen.findByText(/Queued 3 of 3/)).toBeInTheDocument();
      expect(api.calls).toContain("roster a@school.test,b@school.test,c@school.test");
      expect(box).toHaveValue("");
    });

    it("offers the lost-code recovery link to copy", async () => {
      adminApi();
      renderAt("/teacher/trips/t1/students");
      expect(await screen.findByLabelText("Lost-code recovery link")).toHaveValue(`${location.origin}/join?trip=t1`);
      expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    });

    it("tells the teacher when an import is refused", async () => {
      const api = adminApi();
      api.rosterRefusal = true;
      const { user } = renderAt("/teacher/trips/t1/students");
      await user.type(await screen.findByLabelText(/Student emails/), "not-an-email");
      await user.click(screen.getByRole("button", { name: "Import + email codes" }));
      expect(await screen.findByText(/Could not import/)).toBeInTheDocument();
    });
  });

  describe("challenges", () => {
    it("adds, edits and (in draft) deletes challenges after confirming", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/challenges");
      const ch = await waitFor(() => card("Challenges"));
      expect(await within(ch).findByText("Gelato selfie")).toBeInTheDocument();
      expect(within(ch).getByText("×2")).toBeInTheDocument();
      expect(within(ch).getByAltText("QR")).toHaveAttribute("src", "/api/challenges/ch1/qr.png");

      await user.type(within(ch).getByLabelText("Title"), " Fountain ");
      await user.click(within(ch).getByRole("button", { name: "Add challenge" }));
      expect(await within(ch).findByText("Fountain")).toBeInTheDocument();

      await user.click(within(ch).getAllByRole("button", { name: "Edit" })[0]!);
      const title = within(ch).getAllByLabelText("Title")[0]!;
      await user.clear(title);
      await user.type(title, "Gelato duo");
      await user.click(within(ch).getByRole("button", { name: "Save" }));
      expect(await within(ch).findByText("Gelato duo")).toBeInTheDocument();

      await user.click(within(ch).getAllByRole("button", { name: "Delete" })[1]!);
      const dialog = screen.getByRole("alertdialog", { name: "Delete “Fountain”?" });
      expect(dialog).toHaveTextContent("Its QR code will stop working.");
      await user.click(within(dialog).getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(within(ch).queryByText("Fountain")).not.toBeInTheDocument());
      expect(api.calls).toEqual([
        `create {"tripId":"t1","title":"Fountain","instructions":"","multiplier":1}`,
        `edit ch1 {"title":"Gelato duo","instructions":"With a gelato","multiplier":2}`,
        "delete ch2",
      ]);
    });

    it("stops adding at voting, editing at reveal, and deleting after draft", async () => {
      adminApi({ phase: "voting" });
      renderAt("/teacher/trips/t1/challenges");
      const ch = await waitFor(() => card("Challenges"));
      await within(ch).findByText("Gelato selfie");
      expect(within(ch).queryByRole("button", { name: "Add challenge" })).not.toBeInTheDocument();
      expect(within(ch).getByRole("button", { name: "Edit" })).toBeInTheDocument();
      expect(within(ch).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    });
  });

  describe("review", () => {
    it.each([
      ["Approve", "approve n1"],
      ["Reject", "reject n1"],
      ["Remove photo", "remove sub1"],
    ])("%s takes the nomination off the review list and the nav badge", async (button, call) => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/review");
      const mod = await waitFor(() => card("Moderation"));
      expect(await within(mod).findByText("1 pending")).toBeInTheDocument();
      expect(await within(nav()).findByRole("link", { name: "Review, 1 pending" })).toBeInTheDocument();
      await user.click(within(mod).getByRole("button", { name: button }));
      expect(await within(mod).findByText("Nothing to review.")).toBeInTheDocument();
      expect(await within(nav()).findByRole("link", { name: "Review" })).toBeInTheDocument();
      expect(api.calls).toEqual([call]);
    });

    it("enlarges a nomination's photo", async () => {
      adminApi();
      const { user, container } = renderAt("/teacher/trips/t1/review");
      await waitFor(() => expect(container.querySelector(".mod-cell img")).not.toBeNull());
      await user.click(container.querySelector<HTMLImageElement>(".mod-cell img")!);
      const dialog = screen.getByRole("dialog", { name: "Photo" });
      expect(within(dialog).getByAltText("Nomination")).toHaveAttribute("src", "/api/submissions/sub1/photo");
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("co-teachers", () => {
    it.each([
      ["new@school.test", "Invite emailed to new@school.test."],
      ["owner@school.test", "Already a teacher on this trip."],
      ["nope@school.test", "Only the trip owner can invite co-teachers."],
    ])("inviting %s → “%s”", async (email, message) => {
      adminApi();
      const { user } = renderAt("/teacher/trips/t1/settings");
      await user.type(await screen.findByLabelText("Invite co-teacher by email"), email);
      await user.click(screen.getByRole("button", { name: "Send invite" }));
      expect(await screen.findByText(message)).toBeInTheDocument();
    });

    it("revokes a pending invite", async () => {
      const api = adminApi();
      const { user } = renderAt("/teacher/trips/t1/settings");
      await user.click(await screen.findByRole("button", { name: "Revoke" }));
      await waitFor(() => expect(screen.queryByText("pending@school.test")).not.toBeInTheDocument());
      expect(api.calls).toEqual(["revoke inv1"]);
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
      expect(screen.queryByRole("heading", { name: "Results & ceremony" })).not.toBeInTheDocument();
    });

    it("let the teacher break a Grand Champion tie and launch the ceremony", async () => {
      const api = adminApi({ phase: "reveal" });
      api.results = [...results];
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      const { user } = renderAt("/teacher/trips/t1/results");
      expect(await screen.findByText(/It's a tie for Grand Champion/)).toBeInTheDocument();
      await user.click(screen.getAllByRole("button", { name: "Crown this team" })[1]!);
      await waitFor(() => expect(screen.queryByText(/It's a tie/)).not.toBeInTheDocument());
      expect(api.calls).toEqual(["crown g2"]);

      await user.click(screen.getByRole("button", { name: "🏆 Launch ceremony" }));
      expect(open).toHaveBeenCalledWith("/ceremony/t1", "_blank", "noopener");
    });
  });
});
