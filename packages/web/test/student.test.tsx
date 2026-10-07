// Student entry: join link, manual code entry, recovery, and the home screen per phase.
import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "./server.js";
import { renderAt } from "./render.js";

const ME = { studentId: "s1", tripId: "t1", tripName: "Rome 2030", phase: "draft", teamId: null };
const meIs = (me: object | null) =>
  http.get("/api/student/me", () => (me ? HttpResponse.json(me) : HttpResponse.json({ error: "unauthorized" }, { status: 401 })));
const teams = (list: object[] = []) => http.get("/api/teams", () => HttpResponse.json({ teams: list }));

describe("join link (/join?code=…)", () => {
  it("redeems the code and lands on the student home", async () => {
    let sent: unknown;
    server.use(
      http.post("/api/student/redeem", async ({ request }) => { sent = await request.json(); return HttpResponse.json({ ok: true }); }),
      meIs(ME), teams(),
    );
    const { location } = renderAt("/join?code=s1.secret");
    expect(await screen.findByText("Rome 2030")).toBeInTheDocument();
    expect(location()).toBe("/");
    expect(sent).toEqual({ code: "s1.secret" });
  });

  it("explains a used or invalid link and points to recovery", async () => {
    server.use(http.post("/api/student/redeem", () => HttpResponse.json({ error: "invalid" }, { status: 400 })));
    renderAt("/join?code=nope");
    expect(await screen.findByText(/invalid or has already been used/)).toBeInTheDocument();
  });

  it("says so when the link has no code", () => {
    renderAt("/join");
    expect(screen.getByText("Missing code.")).toBeInTheDocument();
  });
});

describe("recovery link (/join?trip=…)", () => {
  it.each([200, 404, 500])("always confirms neutrally (API answered %i) — never reveals whether the email matched", async (status) => {
    let sent: unknown;
    server.use(http.post("/api/student/reissue", async ({ request }) => {
      sent = await request.json();
      return HttpResponse.json({ ok: status === 200 }, { status });
    }));
    const { user } = renderAt("/join?trip=t1");
    const send = screen.getByRole("button", { name: "Send me a new code" });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("Email"), "  kid@school.test ");
    await user.click(send);
    expect(await screen.findByText("Check your inbox")).toBeInTheDocument();
    expect(sent).toEqual({ tripId: "t1", email: "kid@school.test" });
  });
});

describe("student home", () => {
  it("offers manual code entry when signed out, then shows the trip once redeemed", async () => {
    let signedIn = false;
    server.use(
      http.get("/api/student/me", () => signedIn ? HttpResponse.json(ME) : HttpResponse.json({}, { status: 401 })),
      teams(),
      http.post("/api/student/redeem", () => { signedIn = true; return HttpResponse.json({ ok: true }); }),
    );
    const { user } = renderAt("/");
    await user.type(await screen.findByLabelText("Access code"), "FOX-7Q2K");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Rome 2030")).toBeInTheDocument();
  });

  it("shows an error for a bad manual code", async () => {
    server.use(meIs(null), teams(), http.post("/api/student/redeem", () => HttpResponse.json({}, { status: 400 })));
    const { user } = renderAt("/");
    await user.type(await screen.findByLabelText("Access code"), "BAD");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("That code is invalid or has already been used.")).toBeInTheDocument();
  });

  it("reports an unexpected failure instead of a blank screen", async () => {
    server.use(http.get("/api/student/me", () => HttpResponse.json({}, { status: 500 })), teams());
    renderAt("/");
    expect(await screen.findByText("Something went wrong.")).toBeInTheDocument();
  });

  it.each([
    ["draft", null, "Form or join your team", "Go to teams"],
    ["challenge", null, "Snap the challenges", "Join a team"],
    ["challenge", "team1", "Snap the challenges", "See your challenges"],
    ["voting", "team1", "Vote on the duels", "Start voting"],
    ["reveal", "team1", "Results are in", null],
  ])("in %s (team %s) the next step is “%s”", async (phase, teamId, title, button) => {
    server.use(meIs({ ...ME, phase, teamId }), teams([{ id: "team1", name: "Foxes", members: 2 }]));
    renderAt("/");
    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    if (button) expect(screen.getByRole("button", { name: button })).toBeInTheDocument();
    if (teamId) await waitFor(() => expect(screen.getByRole("heading", { name: "Foxes" })).toBeInTheDocument());
    else expect(screen.getByRole("heading", { name: "No team yet" })).toBeInTheDocument();
  });
});

describe("when the API is busy or failing (#67)", () => {
  it("home says the service is busy and retries, instead of a dead end", async () => {
    let calls = 0;
    server.use(
      http.get("/api/student/me", () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ statusCode: 429, error: "rate_limited", message: "Too many requests — try again in 1 minute." }, { status: 429 })
          : HttpResponse.json(ME);
      }),
      teams(),
    );
    const { user } = renderAt("/");
    expect(await screen.findByText(/Too many requests — try again in 1 minute\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Rome 2030")).toBeInTheDocument();
  });

  it("home shows the server's reason for other failures", async () => {
    server.use(
      http.get("/api/student/me", () => HttpResponse.json({ error: "database_unavailable", message: "The database is unavailable." }, { status: 503 })),
      teams(),
    );
    renderAt("/");
    expect(await screen.findByText(/The database is unavailable\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("the team page never claims teams are locked when it just couldn't load", async () => {
    server.use(
      http.get("/api/student/me", () => HttpResponse.json({ error: "rate_limited", message: "Too many requests — try again in 1 minute." }, { status: 429 })),
      teams(),
    );
    renderAt("/team");
    expect(await screen.findByText(/Too many requests/)).toBeInTheDocument();
    expect(screen.queryByText("Teams are locked")).not.toBeInTheDocument();
  });
});
