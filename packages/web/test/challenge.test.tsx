// Scanning a challenge QR (/c/:slug): sign-in gate, phase/team gates, upload, nominate.
import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { server } from "./server.js";
import { renderAt } from "./render.js";

const CH = { id: "ch1", title: "Gelato selfie", instructions: "With a gelato.\nAll of you." };
const ME = { studentId: "s1", tripId: "t1", tripName: "Rome 2030", phase: "challenge", teamId: "team1" };

const challenge = () => http.get("/api/challenges/by-slug/abc", () => HttpResponse.json(CH));
const me = (m: object | null) =>
  http.get("/api/student/me", () => (m ? HttpResponse.json(m) : HttpResponse.json({}, { status: 401 })));

describe("challenge page", () => {
  // #80
  it("shows a placeholder while the challenge loads, then a photo-grid one for the team's photos", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    server.use(
      http.get("/api/challenges/by-slug/abc", async () => { await held; return HttpResponse.json(CH); }),
      me(ME),
      http.get("/api/submissions", async () => { await delay("infinite"); return HttpResponse.json({ submissions: [] }); }),
    );
    renderAt("/c/abc");
    expect(screen.getByRole("status", { name: "Chargement" })).toBeInTheDocument();
    release();
    expect(await screen.findByRole("status", { name: "Chargement des photos" })).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("says so for an unknown QR", async () => {
    server.use(http.get("/api/challenges/by-slug/abc", () => HttpResponse.json({}, { status: 404 })), me(ME));
    renderAt("/c/abc");
    expect(await screen.findByText("Défi introuvable.")).toBeInTheDocument();
  });

  it("shows the challenge to anyone, and asks for an access code before uploading", async () => {
    let signedIn = false;
    let offline = false;
    server.use(
      challenge(),
      http.get("/api/student/me", () => (signedIn ? HttpResponse.json(ME) : HttpResponse.json({}, { status: 401 }))),
      http.post("/api/student/redeem", async ({ request }) => {
        if (offline) return HttpResponse.error();
        const { code } = (await request.json()) as { code: string };
        if (code !== "GOOD") return HttpResponse.json({}, { status: 400 });
        signedIn = true;
        return HttpResponse.json({ ok: true });
      }),
      http.get("/api/submissions", () => HttpResponse.json({ submissions: [] })),
    );
    const { user } = renderAt("/c/abc");
    expect(await screen.findByRole("heading", { name: "Gelato selfie" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Code d'accès"), "BAD");
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    expect(await screen.findByText("Code non valide.")).toBeInTheDocument();

    // #69: an outage is not an invalid code.
    offline = true;
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    expect(await screen.findByText(/Impossible de joindre le serveur/)).toBeInTheDocument();
    offline = false;

    await user.clear(screen.getByLabelText("Code d'accès"));
    await user.type(screen.getByLabelText("Code d'accès"), "GOOD");
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    expect(await screen.findByRole("button", { name: "Envoyer" })).toBeInTheDocument();
  });

  it("closes uploads outside the challenge period", async () => {
    server.use(challenge(), me({ ...ME, phase: "voting" }));
    renderAt("/c/abc");
    expect(await screen.findByText("L'envoi de photos est fermé (phase : Vote).")).toBeInTheDocument();
  });

  it("lets a student without a team play solo, then upload (#79)", async () => {
    let teamId: string | null = null;
    server.use(
      challenge(),
      http.get("/api/student/me", () => HttpResponse.json({ ...ME, teamId })),
      http.post("/api/teams", async ({ request }) => {
        expect(await request.json()).toEqual({ name: "Lone wolf" });
        teamId = "solo1";
        return HttpResponse.json({ teamId }, { status: 201 });
      }),
      http.get("/api/teams", () => HttpResponse.json({ teams: [] })),
      http.get("/api/submissions", () => HttpResponse.json({ submissions: [] })),
      http.get("/api/challenges/for-student", () => HttpResponse.json({ challenges: [] })),
    );
    const { user } = renderAt("/c/abc");
    await user.type(await screen.findByLabelText("Ton nom de joueur"), "Lone wolf");
    await user.click(screen.getByRole("button", { name: "Jouer en solo" }));
    expect(await screen.findByRole("button", { name: "Envoyer" })).toBeInTheDocument();
  });

  it("uploads the chosen photo to this challenge and lists it", async () => {
    const subs: { id: string; created_at: string; nominated: boolean }[] = [];
    let uploaded: { challengeId: string | null; body: string } | undefined;
    server.use(
      challenge(), me(ME),
      http.get("/api/submissions", () => HttpResponse.json({ submissions: subs })),
      http.post("/api/submissions", async ({ request }) => {
        // Raw multipart: undici's formData() parser rejects jsdom's global File in this env.
        uploaded = { challengeId: new URL(request.url).searchParams.get("challengeId"), body: await request.text() };
        expect(request.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
        subs.push({ id: "sub1", created_at: "2030-01-01", nominated: false });
        return HttpResponse.json({ id: "sub1" }, { status: 201 });
      }),
    );
    const { user, container } = renderAt("/c/abc");
    expect(await screen.findByText("Pas encore de photo.")).toBeInTheDocument();

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, new File(["jpeg"], "gelato.jpg", { type: "image/jpeg" }));
    await user.click(screen.getByRole("button", { name: "Envoyer" }));

    expect(await screen.findByRole("button", { name: "Sélectionner" })).toBeInTheDocument();
    expect(uploaded?.challengeId).toBe("ch1");
    expect(uploaded?.body).toMatch(/name="file"; filename="gelato.jpg"\r\nContent-Type: image\/jpeg\r\n\r\njpeg\r\n/);
    expect(input.value).toBe("");
  });

  it("does nothing when Upload is pressed without a photo", async () => {
    server.use(challenge(), me(ME), http.get("/api/submissions", () => HttpResponse.json({ submissions: [] })));
    const { user } = renderAt("/c/abc");
    await user.click(await screen.findByRole("button", { name: "Envoyer" }));
    expect(screen.queryByText(/Échec/i)).not.toBeInTheDocument(); // and no POST (unhandled requests fail the test)
  });

  it("shows the server's reason when an upload is refused", async () => {
    server.use(
      challenge(), me(ME),
      http.get("/api/submissions", () => HttpResponse.json({ submissions: [] })),
      http.post("/api/submissions", () => HttpResponse.json({ error: "infected", message: "file failed the virus scan" }, { status: 422 })),
    );
    const { user, container } = renderAt("/c/abc");
    await screen.findByText("Pas encore de photo.");
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, new File(["x"], "x.jpg", { type: "image/jpeg" }));
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(await screen.findByText(/file failed the virus scan/)).toBeInTheDocument();
  });

  it("nominates a photo for the team", async () => {
    const subs = [{ id: "sub1", created_at: "2030-01-01", nominated: false }];
    let nominated: unknown;
    server.use(
      challenge(), me(ME),
      http.get("/api/submissions", () => HttpResponse.json({ submissions: subs })),
      http.post("/api/nominations", async ({ request }) => {
        nominated = await request.json();
        subs[0]!.nominated = true;
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );
    const { user } = renderAt("/c/abc");
    await user.click(await screen.findByRole("button", { name: "Sélectionner" }));
    expect(await screen.findByRole("button", { name: "Sélectionnée ✓" })).toBeInTheDocument();
    expect(nominated).toEqual({ challengeId: "ch1", submissionId: "sub1" });
  });

  it("marks the pick at once, before the server answers, and moves the mark to the new pick", async () => {
    const subs = [
      { id: "sub1", created_at: "2030-01-01", nominated: true },
      { id: "sub2", created_at: "2030-01-02", nominated: false },
    ];
    server.use(
      challenge(), me(ME),
      http.get("/api/submissions", () => HttpResponse.json({ submissions: subs })),
      http.post("/api/nominations", async () => {
        await delay(400); // a slow network: only an optimistic update shows the pick right away
        subs[0]!.nominated = false; subs[1]!.nominated = true;
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );
    const { user } = renderAt("/c/abc");
    await user.click(await screen.findByRole("button", { name: "Sélectionner" }));
    expect(screen.getByRole("button", { name: "Sélectionnée ✓" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Sélectionn/ }).map((b) => b.textContent)).toEqual(["Sélectionner", "Sélectionnée ✓"]);
  });

  // #81
  it("marks each photo's entry state and explains a rejection", async () => {
    server.use(
      challenge(), me(ME),
      http.get("/api/submissions", () => HttpResponse.json({ submissions: [
        { id: "s1", created_at: "x", nominated: false, entry: null },
        { id: "s2", created_at: "x", nominated: false, entry: "rejected" },
      ] })),
    );
    renderAt("/c/abc");
    expect(await screen.findByText(/Ton enseignant a refusé ta photo/)).toBeInTheDocument();
    expect(screen.getByText("❌ Refusée")).toBeInTheDocument();
  });

  it.each([["pending", "⏳ En attente de ton enseignant"], ["approved", "✅ Validée"]])("shows a %s entry", async (entry, text) => {
    server.use(
      challenge(), me(ME),
      http.get("/api/submissions", () => HttpResponse.json({ submissions: [{ id: "s1", created_at: "x", nominated: true, entry }] })),
    );
    renderAt("/c/abc");
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByText(/a refusé/)).not.toBeInTheDocument();
  });

  it("puts the mark back when a nomination is refused", async () => {
    server.use(
      challenge(), me(ME),
      http.get("/api/submissions", () => HttpResponse.json({ submissions: [{ id: "sub1", created_at: "x", nominated: false }] })),
      http.post("/api/nominations", () => HttpResponse.json({ error: "closed", message: "nominations are closed" }, { status: 409 })),
    );
    const { user } = renderAt("/c/abc");
    await user.click(await screen.findByRole("button", { name: "Sélectionner" }));
    await waitFor(() => expect(screen.getByText(/nominations are closed/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Sélectionner" })).toBeInTheDocument();
  });

  it("tells the student when a nomination is refused", async () => {
    server.use(
      challenge(), me(ME),
      http.get("/api/submissions", () => HttpResponse.json({ submissions: [{ id: "sub1", created_at: "x", nominated: false }] })),
      http.post("/api/nominations", () => HttpResponse.json({ error: "closed", message: "nominations are closed" }, { status: 409 })),
    );
    const { user } = renderAt("/c/abc");
    await user.click(await screen.findByRole("button", { name: "Sélectionner" }));
    await waitFor(() => expect(screen.getByText(/nominations are closed/)).toBeInTheDocument());
  });
});
