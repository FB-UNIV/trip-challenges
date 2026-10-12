// Scanning a challenge QR (/c/:slug): sign-in gate, phase/team gates, sending photos, nominating.
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { server } from "./server.js";
import { renderAt } from "./render.js";

type User = ReturnType<typeof renderAt>["user"];

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
    expect(await screen.findByLabelText(/Prendre une photo/)).toBeInTheDocument();
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
    expect(await screen.findByLabelText(/Prendre une photo/)).toBeInTheDocument();
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

describe("sending photos", () => {
  type Sub = { id: string; created_at: string; nominated: boolean };
  const photo = (name = "gelato.jpg") => new File(["jpeg"], name, { type: "image/jpeg" });
  const filename = (body: string) => /filename="([^"]+)"/.exec(body)?.[1];
  const listed = (subs: Sub[]) => http.get("/api/submissions", () => HttpResponse.json({ submissions: subs }));
  const added = (subs: Sub[]) => subs.push({ id: `sub${subs.length + 1}`, created_at: "2030-01-01", nominated: false });
  /** Take a photo with the camera and send it from the review screen. */
  const takePhoto = async (user: User, file: File) => {
    await user.upload(screen.getByLabelText(/Prendre une photo/), file);
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
  };

  it("opens the camera, or the gallery to pick several photos at once", async () => {
    server.use(challenge(), me(ME), listed([]));
    renderAt("/c/abc");
    const camera = await screen.findByLabelText(/Prendre une photo/);
    expect(camera).toHaveAttribute("capture", "environment");
    expect(camera).not.toHaveAttribute("multiple");
    const gallery = screen.getByLabelText(/Galerie/);
    expect(gallery).not.toHaveAttribute("capture");
    expect(gallery).toHaveAttribute("multiple");
    expect(gallery).toHaveAttribute("accept", "image/*");
  });

  it("sends a photo as soon as it's taken, shows it with its progress meanwhile, then lists it", async () => {
    const subs: Sub[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let uploaded: { challengeId: string | null; type: string | null; body: string } | undefined;
    server.use(
      challenge(), me(ME), listed(subs),
      http.post("/api/submissions", async ({ request }) => {
        uploaded = {
          challengeId: new URL(request.url).searchParams.get("challengeId"),
          type: request.headers.get("content-type"),
          body: await request.text(),
        };
        await held;
        added(subs);
        return HttpResponse.json({ id: "sub1" }, { status: 201 });
      }),
    );
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const { user } = renderAt("/c/abc");
    await screen.findByText("Pas encore de photo.");
    const camera = screen.getByLabelText<HTMLInputElement>(/Prendre une photo/);
    await user.upload(camera, photo());
    await user.click(screen.getByRole("button", { name: "Envoyer" }));

    expect(await screen.findByRole("progressbar", { name: "Envoi de la photo" })).toBeInTheDocument();
    const preview = screen.getByRole("img", { name: "Photo en cours d'envoi" });
    expect(preview.getAttribute("src")).toMatch(/^blob:/);
    expect(screen.queryByText("Pas encore de photo.")).not.toBeInTheDocument();

    release();
    expect(await screen.findByRole("button", { name: "Sélectionner" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "Envoi de la photo" })).not.toBeInTheDocument();
    expect(revoke).toHaveBeenCalledWith(preview.getAttribute("src"));
    expect(uploaded?.challengeId).toBe("ch1");
    expect(uploaded?.type).toMatch(/^multipart\/form-data; boundary=/);
    expect(uploaded?.body).toMatch(/name="file"; filename="gelato.jpg"\r\nContent-Type: image\/jpeg\r\n\r\njpeg\r\n/);
    expect(camera.value).toBe("");
  });

  it("sends several gallery photos one after another", async () => {
    const subs: Sub[] = [];
    const order: (string | undefined)[] = [];
    let inFlight = 0;
    let most = 0;
    server.use(
      challenge(), me(ME), listed(subs),
      http.post("/api/submissions", async ({ request }) => {
        most = Math.max(most, ++inFlight);
        order.push(filename(await request.text()));
        await delay(20);
        inFlight--;
        added(subs);
        return HttpResponse.json({ id: "x" }, { status: 201 });
      }),
    );
    const { user } = renderAt("/c/abc");
    await screen.findByText("Pas encore de photo.");
    await user.upload(screen.getByLabelText(/Galerie/), [photo("a.jpg"), photo("b.jpg"), photo("c.jpg")]);
    expect(screen.getAllByRole("img", { name: "Photo en cours d'envoi" })).toHaveLength(3);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Sélectionner" })).toHaveLength(3));
    expect(order).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(most).toBe(1);
  });

  it("keeps a refused photo on screen with the reason, and sends it again on retry", async () => {
    const subs: Sub[] = [];
    let refuse = true;
    server.use(
      challenge(), me(ME), listed(subs),
      http.post("/api/submissions", () => {
        if (refuse) return HttpResponse.json({ error: "infected", message: "file failed the virus scan" }, { status: 422 });
        added(subs);
        return HttpResponse.json({ id: "sub1" }, { status: 201 });
      }),
    );
    const { user } = renderAt("/c/abc");
    await screen.findByText("Pas encore de photo.");
    await takePhoto(user, photo());
    expect(await screen.findByText(/file failed the virus scan/)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "Envoi de la photo" })).not.toBeInTheDocument();

    refuse = false;
    await user.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByRole("button", { name: "Sélectionner" })).toBeInTheDocument();
    expect(screen.queryByText(/file failed the virus scan/)).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Photo en cours d'envoi" })).not.toBeInTheDocument();
  });

  it("says when the server can't be reached, and lets the student drop the photo", async () => {
    server.use(challenge(), me(ME), listed([]), http.post("/api/submissions", () => HttpResponse.error()));
    const { user } = renderAt("/c/abc");
    await screen.findByText("Pas encore de photo.");
    await takePhoto(user, photo());
    expect(await screen.findByText(/Impossible de joindre le serveur/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retirer" }));
    expect(screen.queryByRole("img", { name: "Photo en cours d'envoi" })).not.toBeInTheDocument();
    expect(screen.getByText("Pas encore de photo.")).toBeInTheDocument();
  });

  it("gives a reference to quote when the server breaks", async () => {
    server.use(
      challenge(), me(ME), listed([]),
      http.post("/api/submissions", () => HttpResponse.json({ error: "internal", message: "Erreur interne.", requestId: "req-42" }, { status: 500 })),
    );
    const { user } = renderAt("/c/abc");
    await screen.findByText("Pas encore de photo.");
    await takePhoto(user, photo());
    expect(await screen.findByText(/Erreur interne\. Référence : req-42/)).toBeInTheDocument();
  });

  it("sends nothing when the picker is closed without a photo", async () => {
    server.use(challenge(), me(ME), listed([]));
    const { user } = renderAt("/c/abc");
    await screen.findByText("Pas encore de photo.");
    await user.upload(screen.getByLabelText(/Galerie/), []);
    expect(screen.queryByRole("img", { name: "Photo en cours d'envoi" })).not.toBeInTheDocument(); // and no POST
  });
});

describe("reviewing a photo before it's sent", () => {
  type Sub = { id: string; created_at: string; nominated: boolean };
  const photo = (name = "gelato.jpg") => new File(["jpeg"], name, { type: "image/jpeg" });
  const review = () => screen.queryByRole("dialog", { name: "Ta photo" });
  const sent = () => screen.queryByRole("dialog", { name: "Photo envoyée" });
  /** The team's photos, and an upload endpoint that lists what it receives as `sub1`, `sub2`… */
  const team = (subs: Sub[]) => {
    const posts: string[] = [];
    server.use(
      challenge(), me(ME),
      http.get("/api/submissions", () => HttpResponse.json({ submissions: subs })),
      http.post("/api/submissions", async ({ request }) => {
        posts.push(await request.text());
        const id = `sub${subs.length + 1}`;
        subs.push({ id, created_at: "2030-01-01", nominated: false });
        return HttpResponse.json({ id }, { status: 201 });
      }),
    );
    return posts;
  };

  it("shows a taken photo full screen, and sends it only on Envoyer", async () => {
    const posts = team([]);
    const { user } = renderAt("/c/abc");
    await user.upload(await screen.findByLabelText(/Prendre une photo/), photo());
    expect(review()).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Ta photo" }).getAttribute("src")).toMatch(/^blob:/);
    expect(posts).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(review()).not.toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "Photo envoyée" })).toBeInTheDocument();
    expect(posts).toHaveLength(1);
  });

  it("Reprendre drops the photo and opens the camera again", async () => {
    const posts = team([]);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const { user } = renderAt("/c/abc");
    const camera = await screen.findByLabelText<HTMLInputElement>(/Prendre une photo/);
    await user.upload(camera, photo());
    const shown = screen.getByRole("img", { name: "Ta photo" }).getAttribute("src");
    const reopened = vi.fn();
    camera.addEventListener("click", reopened);

    await user.click(screen.getByRole("button", { name: "Reprendre" }));
    expect(review()).not.toBeInTheDocument();
    expect(reopened).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith(shown);
    expect(posts).toHaveLength(0);
  });

  it("Annuler closes it without sending", async () => {
    const posts = team([]);
    const { user } = renderAt("/c/abc");
    await user.upload(await screen.findByLabelText(/Prendre une photo/), photo());
    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(review()).not.toBeInTheDocument();
    expect(screen.getByText("Pas encore de photo.")).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });

  it("reviews a single photo from the gallery too", async () => {
    team([]);
    const { user } = renderAt("/c/abc");
    await user.upload(await screen.findByLabelText(/Galerie/), photo());
    expect(review()).toBeInTheDocument();
  });

  it("once sent, offers to make it the team's entry when there is none yet", async () => {
    const subs: Sub[] = [];
    team(subs);
    let nominated: unknown;
    server.use(http.post("/api/nominations", async ({ request }) => {
      nominated = await request.json();
      subs[0]!.nominated = true;
      return HttpResponse.json({ ok: true }, { status: 201 });
    }));
    const { user } = renderAt("/c/abc");
    await user.upload(await screen.findByLabelText(/Prendre une photo/), photo());
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    await screen.findByRole("dialog", { name: "Photo envoyée" });
    expect(screen.getByText(/C'est votre photo pour le vote/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "On la met en lice" }));
    expect(sent()).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Sélectionnée ✓" })).toBeInTheDocument();
    expect(nominated).toEqual({ challengeId: "ch1", submissionId: "sub1" });
  });

  it("Plus tard leaves the entry to choose later", async () => {
    team([]); // and no POST /api/nominations
    const { user } = renderAt("/c/abc");
    await user.upload(await screen.findByLabelText(/Prendre une photo/), photo());
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    await screen.findByRole("dialog", { name: "Photo envoyée" });
    await user.click(screen.getByRole("button", { name: "Plus tard" }));
    expect(sent()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sélectionner" })).toBeInTheDocument();
  });

  it("only celebrates when the team already has an entry", async () => {
    team([{ id: "sub1", created_at: "2030-01-01", nominated: true }]);
    const { user } = renderAt("/c/abc");
    await user.upload(await screen.findByLabelText(/Prendre une photo/), photo());
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    await screen.findByRole("dialog", { name: "Photo envoyée" });
    expect(screen.queryByRole("button", { name: "On la met en lice" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    expect(sent()).not.toBeInTheDocument();
  });

  it("doesn't interrupt a batch from the gallery", async () => {
    team([]);
    const { user } = renderAt("/c/abc");
    await user.upload(await screen.findByLabelText(/Galerie/), [photo("a.jpg"), photo("b.jpg")]);
    expect(review()).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Sélectionner" })).toHaveLength(2));
    expect(sent()).not.toBeInTheDocument();
  });

  it("says when the entry couldn't be set", async () => {
    team([]);
    server.use(http.post("/api/nominations", () => HttpResponse.json({ error: "closed", message: "nominations are closed" }, { status: 409 })));
    const { user } = renderAt("/c/abc");
    await user.upload(await screen.findByLabelText(/Prendre une photo/), photo());
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    await screen.findByRole("dialog", { name: "Photo envoyée" });
    await user.click(screen.getByRole("button", { name: "On la met en lice" }));
    expect(await screen.findByText(/nominations are closed/)).toBeInTheDocument();
  });
});
