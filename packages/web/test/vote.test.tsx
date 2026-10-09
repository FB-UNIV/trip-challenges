// Voting (ADR-0002): the challenge list (with my progress) and the duel screen.
import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "./server.js";
import { renderAt } from "./render.js";

const ME = { studentId: "s1", tripId: "t1", tripName: "Rome 2030", phase: "voting", teamId: "team1" };
const pair = (n: number) => ({
  challengeId: "ch1",
  aNominationId: `a${n}`, bNominationId: `b${n}`,
  aSubmissionId: `sa${n}`, bSubmissionId: `sb${n}`,
  pairToken: `token${n}`,
});
type Status = "todo" | "in_progress" | "done" | "not_enough";
const ch = (id: string, title: string, voted: number, total: number, status: Status) => ({
  id, title, instructions: "", qrSlug: `slug-${id}`, photos: 1, nominated: true,
  vote: { voted, total, status },
});
const meIs = (me: object) => http.get("/api/student/me", () => HttpResponse.json(me));
const listIs = (challenges: object[]) => http.get("/api/challenges/for-student", () => HttpResponse.json({ challenges }));
// The loading Skeleton is a status region too, so find the celebration by its own title.
const statusWith = async (title: string) => (await screen.findByText(title)).closest("[role=status]") as HTMLElement;
const titlesInOrder = (container: HTMLElement) =>
  [...container.querySelectorAll(".check-row b")].map((b) => b.textContent);

describe("vote home", () => {
  it("puts what's left first, with progress; finished challenges sink and aren't links", async () => {
    server.use(meIs(ME), listIs([
      ch("c1", "Statue selfie", 1, 1, "done"),
      ch("c2", "Gelato", 0, 3, "todo"),
      ch("c3", "Street sign", 0, 0, "not_enough"),
      ch("c4", "Pyramid", 2, 6, "in_progress"),
    ]));
    const { container } = renderAt("/vote");

    expect(await screen.findByRole("link", { name: /Pyramid/ })).toHaveAttribute("href", "/vote/c4");
    expect(titlesInOrder(container)).toEqual(["Pyramid", "Gelato", "Street sign", "Statue selfie"]);
    expect(screen.getByRole("progressbar", { name: "Pyramid duels" })).toHaveTextContent("2/6");
    expect(screen.getByRole("link", { name: /Gelato/ })).toHaveAttribute("href", "/vote/c2");
    expect(screen.queryByRole("link", { name: /Statue selfie/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Street sign/ })).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for photos")).toBeInTheDocument();
    // Overall: challenges that can be voted on (not "waiting"), how many are finished.
    const overall = screen.getByRole("progressbar", { name: "Challenges voted" });
    expect(overall).toHaveAttribute("aria-valuenow", "1");
    expect(overall).toHaveAttribute("aria-valuemax", "3");
  });

  it("celebrates once every challenge is voted", async () => {
    server.use(meIs(ME), listIs([ch("c1", "Statue selfie", 1, 1, "done"), ch("c2", "Gelato", 3, 3, "done")]));
    renderAt("/vote");
    expect(await statusWith("All voted!")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Gelato/ })).not.toBeInTheDocument();
  });

  it("shows an empty state when nothing can be voted on yet", async () => {
    server.use(meIs(ME), listIs([ch("c3", "Street sign", 0, 0, "not_enough")]));
    renderAt("/vote");
    expect(await screen.findByText("Nothing to vote on yet")).toBeInTheDocument();
  });

  it("shows an empty state for a trip with no challenges", async () => {
    server.use(meIs(ME), listIs([]));
    renderAt("/vote");
    expect(await screen.findByText("Nothing to vote on yet")).toBeInTheDocument();
  });

  it.each([
    ["challenge", "Voting opens soon"],
    ["reveal", "Voting is closed"],
  ])("isn't open in phase %s", async (phase, text) => {
    server.use(meIs({ ...ME, phase }), listIs([]));
    renderAt("/vote");
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("treats a voting trip past its close time as closed", async () => {
    server.use(meIs(ME), listIs([{ ...ch("c1", "Gelato", 0, 3, "todo"), vote: null }]));
    renderAt("/vote");
    expect(await screen.findByText("Voting is closed")).toBeInTheDocument();
  });

  it("shows a loading placeholder, not text", () => {
    server.use(meIs(ME), listIs([]));
    renderAt("/vote");
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });
});

describe("duel screen", () => {
  it("casts the picked photo, fills the progress bar, then offers the next unfinished challenge", async () => {
    const pairs = [pair(1), pair(2)];
    const casts: unknown[] = [];
    server.use(
      listIs([ch("ch1", "Gelato", 0, 2, "todo"), ch("ch2", "Pyramid", 0, 1, "todo"), ch("ch3", "Statue", 1, 1, "done")]),
      http.get("/api/duels/next", ({ request }) => {
        expect(new URL(request.url).searchParams.get("challengeId")).toBe("ch1");
        const p = pairs.shift();
        return HttpResponse.json(p ? { pair: p } : { pair: null, reason: "exhausted" });
      }),
      http.post("/api/duels/cast", async ({ request }) => { casts.push(await request.json()); return HttpResponse.json({ ok: true }); }),
    );
    const { user } = renderAt("/vote/ch1");
    const bar = await screen.findByRole("progressbar", { name: "Duels voted" });
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "2");
    const [a] = await screen.findAllByRole("button", { name: "Pick this photo" });
    expect(a!.querySelector("img")).toHaveAttribute("src", "/api/submissions/sa1/photo");

    await user.click(a!);
    await screen.findByText("1 / 2");
    expect(screen.getByRole("progressbar", { name: "Duels voted" })).toHaveAttribute("aria-valuenow", "1");
    await user.click(screen.getAllByRole("button", { name: "Pick this photo" })[1]!);

    const done = await statusWith("Challenge done!");
    expect(within(done).getByRole("link", { name: /Next challenge/ })).toHaveAttribute("href", "/vote/ch2");
    expect(casts).toEqual([
      { pairToken: "token1", winnerNominationId: "a1" },
      { pairToken: "token2", winnerNominationId: "b2" },
    ]);
  });

  it("celebrates the last challenge and leads back to the list", async () => {
    server.use(
      listIs([ch("ch1", "Gelato", 1, 1, "done"), ch("ch2", "Pyramid", 0, 0, "not_enough")]),
      http.get("/api/duels/next", () => HttpResponse.json({ pair: null, reason: "exhausted" })),
    );
    renderAt("/vote/ch1");
    const done = await statusWith("All voted!");
    expect(within(done).getByRole("link", { name: /Back to challenges/ })).toHaveAttribute("href", "/vote");
  });

  it.each([
    ["closed", "Voting is closed"],
    ["not_enough", "Waiting for more photos"],
  ])("shows a %s challenge as a visual empty state", async (reason, text) => {
    server.use(listIs([]), http.get("/api/duels/next", () => HttpResponse.json({ pair: null, reason })));
    renderAt("/vote/ch1");
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back/ })).toBeInTheDocument();
  });

  it("recovers when a vote is refused (e.g. voting closed mid-duel) instead of hanging", async () => {
    let open = true;
    server.use(
      listIs([ch("ch1", "Gelato", 0, 1, "todo")]),
      http.get("/api/duels/next", () => HttpResponse.json(open ? { pair: pair(1) } : { pair: null, reason: "closed" })),
      http.post("/api/duels/cast", () => { open = false; return HttpResponse.json({ error: "closed" }, { status: 409 }); }),
    );
    const { user } = renderAt("/vote/ch1");
    await user.click((await screen.findAllByRole("button", { name: "Pick this photo" }))[0]!);
    expect(await screen.findByText("Voting is closed")).toBeInTheDocument();
  });

  // #69: a failure must not look like "nothing happened" (or an endless skeleton).
  it("explains a duel that fails to load, and retries", async () => {
    let down = true;
    server.use(
      listIs([ch("ch1", "Gelato", 0, 1, "todo")]),
      http.get("/api/duels/next", () => down
        ? HttpResponse.json({ error: "database_unavailable", message: "The database is unavailable right now.", requestId: "r-9" }, { status: 503 })
        : HttpResponse.json({ pair: pair(1) })),
    );
    const { user } = renderAt("/vote/ch1");
    expect(await screen.findByText("The database is unavailable right now.")).toBeInTheDocument();
    expect(screen.getByText(/^Reference:/)).toHaveTextContent("r-9");
    down = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findAllByRole("button", { name: "Pick this photo" })).toHaveLength(2);
  });

  it("keeps the pair and says so when a vote can't be saved, so it can be cast again", async () => {
    const casts: unknown[] = [];
    let down = true;
    server.use(
      listIs([ch("ch1", "Gelato", 0, 1, "todo")]),
      http.get("/api/duels/next", () => HttpResponse.json(casts.length ? { pair: null, reason: "exhausted" } : { pair: pair(1) })),
      http.post("/api/duels/cast", async ({ request }) => {
        if (down) return HttpResponse.json({ error: "internal_error", message: "Something went wrong on our side.", requestId: "r-7" }, { status: 500 });
        casts.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    const { user } = renderAt("/vote/ch1");
    await user.click((await screen.findAllByRole("button", { name: "Pick this photo" }))[0]!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Your vote wasn't saved. Something went wrong on our side. Reference: r-7");
    expect(screen.getAllByRole("button", { name: "Pick this photo" })).toHaveLength(2);

    down = false;
    await user.click(screen.getAllByRole("button", { name: "Pick this photo" })[0]!);
    expect(await screen.findByText("All voted!")).toBeInTheDocument();
    expect(casts).toHaveLength(1);
  });

  it("still lets you vote if the progress list fails to load", async () => {
    server.use(
      http.get("/api/challenges/for-student", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
      http.get("/api/duels/next", () => HttpResponse.json({ pair: pair(1) })),
    );
    renderAt("/vote/ch1");
    expect(await screen.findAllByRole("button", { name: "Pick this photo" })).toHaveLength(2);
    expect(screen.queryByRole("progressbar", { name: "Duels voted" })).not.toBeInTheDocument();
  });
});
