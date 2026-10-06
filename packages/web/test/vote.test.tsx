// Voting (ADR-0002): the challenge list and the duel screen.
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
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

describe("vote home", () => {
  it("lists the trip's challenges to vote on", async () => {
    server.use(
      http.get("/api/student/me", () => HttpResponse.json(ME)),
      http.get("/api/challenges/for-student", () => HttpResponse.json({ challenges: [{ id: "ch1", title: "Gelato selfie", instructions: "" }] })),
    );
    renderAt("/vote");
    expect(await screen.findByRole("link", { name: /Gelato selfie/ })).toHaveAttribute("href", "/vote/ch1");
  });

  it("says when there is nothing to vote on", async () => {
    server.use(
      http.get("/api/student/me", () => HttpResponse.json(ME)),
      http.get("/api/challenges/for-student", () => HttpResponse.json({ challenges: [] })),
    );
    renderAt("/vote");
    expect(await screen.findByText("No challenges to vote on yet.")).toBeInTheDocument();
  });

  it("isn't open outside the voting period", async () => {
    server.use(
      http.get("/api/student/me", () => HttpResponse.json({ ...ME, phase: "challenge" })),
      http.get("/api/challenges/for-student", () => HttpResponse.json({ challenges: [] })),
    );
    renderAt("/vote");
    expect(await screen.findByText("Voting isn't open yet (phase: challenge).")).toBeInTheDocument();
  });
});

describe("duel screen", () => {
  it("casts the picked photo with the pair's token, then serves the next pair until exhausted", async () => {
    const pairs = [pair(1), pair(2)];
    const casts: unknown[] = [];
    server.use(
      http.get("/api/duels/next", ({ request }) => {
        expect(new URL(request.url).searchParams.get("challengeId")).toBe("ch1");
        const p = pairs.shift();
        return HttpResponse.json(p ? { pair: p } : { pair: null, reason: "exhausted" });
      }),
      http.post("/api/duels/cast", async ({ request }) => { casts.push(await request.json()); return HttpResponse.json({ ok: true }); }),
    );
    const { user } = renderAt("/vote/ch1");
    expect(await screen.findByText("You've judged 0")).toBeInTheDocument();
    const [a] = screen.getAllByRole("button", { name: "Pick this photo" });
    expect(a!.querySelector("img")).toHaveAttribute("src", "/api/submissions/sa1/photo");

    await user.click(a!);
    expect(await screen.findByText("You've judged 1")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Pick this photo" })[1]!);

    expect(await screen.findByText(/you've judged them all/)).toBeInTheDocument();
    expect(casts).toEqual([
      { pairToken: "token1", winnerNominationId: "a1" },
      { pairToken: "token2", winnerNominationId: "b2" },
    ]);
  });

  it.each([
    ["closed", /Voting isn't open right now/],
    ["not_enough", /3 or more teams/],
  ])("explains a %s challenge", async (reason, text) => {
    server.use(http.get("/api/duels/next", () => HttpResponse.json({ pair: null, reason })));
    renderAt("/vote/ch1");
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("recovers when a vote is refused (e.g. voting closed mid-duel) instead of hanging on Loading…", async () => {
    let open = true;
    server.use(
      http.get("/api/duels/next", () => HttpResponse.json(open ? { pair: pair(1) } : { pair: null, reason: "closed" })),
      http.post("/api/duels/cast", () => { open = false; return HttpResponse.json({ error: "closed" }, { status: 409 }); }),
    );
    const { user } = renderAt("/vote/ch1");
    await user.click((await screen.findAllByRole("button", { name: "Pick this photo" }))[0]!);
    expect(await screen.findByText(/Voting isn't open right now/)).toBeInTheDocument();
  });
});
