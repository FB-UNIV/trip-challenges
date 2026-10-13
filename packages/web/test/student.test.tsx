// Student entry: join link, manual code entry, recovery, and the home screen per phase.
import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
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
    server.use(http.post("/api/student/redeem", () => HttpResponse.json({ error: "pas valide" }, { status: 400 })));
    renderAt("/join?code=nope");
    expect(await screen.findByText(/n'est pas valide ou a déjà été utilisé/)).toBeInTheDocument();
  });

  it("doesn't call the link invalid when the server is down (#69)", async () => {
    server.use(http.post("/api/student/redeem", () =>
      HttpResponse.json({ error: "database_unavailable", message: "The database is unavailable right now.", requestId: "r-1" }, { status: 503 })));
    renderAt("/join?code=s1.secret");
    expect(await screen.findByText("The database is unavailable right now. Référence : r-1")).toBeInTheDocument();
    expect(screen.queryByText(/pas valide/)).not.toBeInTheDocument();
  });

  // Opening someone else's join link used to swap this phone's account silently (security
  // audit 2026-10): the server now refuses, and the page asks before switching.
  it("asks before switching a phone that's already signed in, and keeps it as is on refusal", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post("/api/student/redeem", async ({ request }) => {
        const body = (await request.json()) as { replace?: boolean };
        bodies.push(body);
        return body.replace
          ? HttpResponse.json({ ok: true })
          : HttpResponse.json({ error: "already_signed_in", message: "Déjà connecté." }, { status: 409 });
      }),
      meIs(ME), teams(),
    );
    const { user, location } = renderAt("/join?code=s2.secret");
    expect(await screen.findByText(/déjà connecté avec un compte élève/)).toBeInTheDocument();
    expect(location()).toBe("/join"); // nothing switched yet

    await user.click(screen.getByRole("button", { name: "Garder mon compte" }));
    expect(await screen.findByText("Rome 2030")).toBeInTheDocument();
    expect(bodies).toEqual([{ code: "s2.secret" }]);
  });

  it("switches account only once the student confirms", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post("/api/student/redeem", async ({ request }) => {
        const body = (await request.json()) as { replace?: boolean };
        bodies.push(body);
        return body.replace
          ? HttpResponse.json({ ok: true })
          : HttpResponse.json({ error: "already_signed_in", message: "Déjà connecté." }, { status: 409 });
      }),
      meIs(ME), teams(),
    );
    const { user, location } = renderAt("/join?code=s2.secret");
    await user.click(await screen.findByRole("button", { name: "Utiliser ce lien" }));
    await waitFor(() => expect(location()).toBe("/"));
    expect(bodies).toEqual([{ code: "s2.secret" }, { code: "s2.secret", replace: true }]);
  });

  it("says so when the link has no code", () => {
    renderAt("/join");
    expect(screen.getByText("Code manquant.")).toBeInTheDocument();
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
    const send = screen.getByRole("button", { name: "M'envoyer un nouveau code" });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("E-mail"), "  kid@school.test ");
    await user.click(send);
    expect(await screen.findByText("Regarde ta boîte mail")).toBeInTheDocument();
    expect(sent).toEqual({ tripId: "t1", email: "kid@school.test" });
  });
});

describe("recovery link when offline", () => {
  it("says the request didn't go out instead of confirming it (#69)", async () => {
    server.use(http.post("/api/student/reissue", () => HttpResponse.error()));
    const { user } = renderAt("/join?trip=t1");
    await user.type(screen.getByLabelText("E-mail"), "kid@school.test");
    await user.click(screen.getByRole("button", { name: "M'envoyer un nouveau code" }));
    expect(await screen.findByText(/Impossible de joindre le serveur/)).toBeInTheDocument();
    expect(screen.queryByText("Regarde ta boîte mail")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "M'envoyer un nouveau code" })).toBeEnabled();
  });
});

describe("student home", () => {
  it("shows a placeholder while it loads (#80)", async () => {
    server.use(http.get("/api/student/me", async () => { await delay("infinite"); return HttpResponse.json(ME); }), teams());
    renderAt("/");
    expect(screen.getByRole("status", { name: "Chargement" })).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("offers manual code entry when signed out, then shows the trip once redeemed", async () => {
    let signedIn = false;
    server.use(
      http.get("/api/student/me", () => signedIn ? HttpResponse.json(ME) : HttpResponse.json({}, { status: 401 })),
      teams(),
      http.post("/api/student/redeem", () => { signedIn = true; return HttpResponse.json({ ok: true }); }),
    );
    const { user } = renderAt("/");
    await user.type(await screen.findByLabelText("Code d'accès"), "FOX-7Q2K");
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    expect(await screen.findByText("Rome 2030")).toBeInTheDocument();
  });

  it("shows an error for a bad manual code", async () => {
    server.use(meIs(null), teams(), http.post("/api/student/redeem", () => HttpResponse.json({}, { status: 400 })));
    const { user } = renderAt("/");
    await user.type(await screen.findByLabelText("Code d'accès"), "BAD");
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    expect(await screen.findByText("Ce code n'est pas valide ou a déjà été utilisé.")).toBeInTheDocument();
  });

  it("doesn't call a code invalid when the server failed (#69)", async () => {
    server.use(meIs(null), teams(), http.post("/api/student/redeem", () => new HttpResponse(null, { status: 429 })));
    const { user } = renderAt("/");
    await user.type(await screen.findByLabelText("Code d'accès"), "FOX-7Q2K");
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    expect(await screen.findByText(/serveur est occupé/)).toBeInTheDocument();
    expect(screen.queryByText(/pas valide/)).not.toBeInTheDocument();
  });

  it("reports an unexpected failure instead of a blank screen", async () => {
    server.use(http.get("/api/student/me", () => HttpResponse.json({}, { status: 500 })), teams());
    renderAt("/");
    expect(await screen.findByText("Une erreur est survenue.")).toBeInTheDocument();
  });

  it.each([
    ["draft", null, "Fais équipe ou joue en solo", "Voir les équipes"],
    ["challenge", null, "Relève les défis", "Jouer en solo"],
    ["challenge", "team1", "Relève les défis", "Voir tes défis"],
    ["voting", "team1", "Vote pour les duels", "Commencer à voter"],
    ["reveal", "team1", "Les résultats sont là", null],
  ])("in %s (team %s) the next step is “%s”", async (phase, teamId, title, button) => {
    server.use(meIs({ ...ME, phase, teamId }), teams([{ id: "team1", name: "Foxes", members: 2 }]));
    renderAt("/");
    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    if (button) expect(screen.getByRole("button", { name: button })).toBeInTheDocument();
    if (teamId) await waitFor(() => expect(screen.getByRole("heading", { name: "Foxes" })).toBeInTheDocument());
    else expect(screen.getByRole("heading", { name: "Pas encore d'équipe" })).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Rome 2030")).toBeInTheDocument();
  });

  it("home shows the server's reason for other failures", async () => {
    server.use(
      http.get("/api/student/me", () => HttpResponse.json({ error: "database_unavailable", message: "The database is unavailable." }, { status: 503 })),
      teams(),
    );
    renderAt("/");
    expect(await screen.findByText(/The database is unavailable\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });

  it("the team page never claims teams are locked when it just couldn't load", async () => {
    server.use(
      http.get("/api/student/me", () => HttpResponse.json({ error: "rate_limited", message: "Too many requests — try again in 1 minute." }, { status: 429 })),
      teams(),
    );
    renderAt("/team");
    expect(await screen.findByText(/Too many requests/)).toBeInTheDocument();
    expect(screen.queryByText("Les équipes sont verrouillées")).not.toBeInTheDocument();
  });
});
