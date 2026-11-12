// Telling a student when a teacher validates or refuses their team's entry, on any student
// screen: as the app polls (or comes back to the foreground), and on returning to the app.
import { afterEach, describe, it, expect, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { focusManager } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "./server.js";
import { renderAt } from "./render.js";

const ME = { studentId: "s1", tripId: "t1", tripName: "Rome 2030", phase: "challenge", teamId: "team1" };
const ch = (id: string, title: string, entry: string | null) => ({
  id, title, instructions: "", qrSlug: `slug-${id}`, photos: 1, nominated: entry !== null && entry !== "rejected", entry, vote: null,
});
/** The student's challenge list, as the teacher's decisions change it. */
function trip(...challenges: ReturnType<typeof ch>[]) {
  const list = { challenges };
  server.use(
    http.get("/api/student/me", () => HttpResponse.json(ME)),
    http.get("/api/challenges/for-student", () => HttpResponse.json(list)),
  );
  return list;
}
/** What this phone already showed the student, as a previous visit left it. */
const seen = (entries: Record<string, string | null>) =>
  localStorage.setItem("entries-seen:t1", JSON.stringify(entries));
const toast = () => screen.queryByRole("status", { name: "Notification" });
/** The app comes back to the foreground once its data is stale: it refetches. */
async function comeBack() {
  vi.setSystemTime(Date.now() + 5_000);
  await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
}

afterEach(() => { vi.useRealTimers(); focusManager.setFocused(undefined); });

describe("entry notifications", () => {
  it("tells the student, while the app is open, that their photo was validated", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const list = trip(ch("c1", "Selfie gelato", "pending"));
    const { user, location } = renderAt("/challenges");
    await screen.findByRole("link", { name: /Selfie gelato/ });
    expect(toast()).not.toBeInTheDocument();

    list.challenges = [ch("c1", "Selfie gelato", "approved")];
    await comeBack();
    const note = await screen.findByRole("status", { name: "Notification" });
    expect(note).toHaveTextContent("✅ Photo validée !");
    expect(note).toHaveTextContent("« Selfie gelato » est en lice pour le vote.");

    await user.click(screen.getByRole("link", { name: "Voir" }));
    expect(location()).toBe("/c/slug-c1");
    expect(toast()).not.toBeInTheDocument();
  });

  it("tells the student when their photo was refused, until they close it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const list = trip(ch("c1", "Selfie gelato", "pending"));
    const { user } = renderAt("/");
    await vi.waitFor(() => expect(localStorage.getItem("entries-seen:t1")).toContain("pending"));

    list.challenges = [ch("c1", "Selfie gelato", "rejected")];
    await comeBack();
    const note = await screen.findByRole("status", { name: "Notification" });
    expect(note).toHaveTextContent("❌ Photo refusée");
    expect(note).toHaveTextContent("« Selfie gelato » : choisis-en une autre.");
    await user.click(screen.getByRole("button", { name: "Fermer la notification" }));
    expect(toast()).not.toBeInTheDocument();
  });

  it("catches up on a decision made while the app was closed", async () => {
    seen({ c1: "pending" });
    trip(ch("c1", "Selfie gelato", "approved"));
    renderAt("/challenges");
    expect(await screen.findByRole("status", { name: "Notification" })).toHaveTextContent("Photo validée");
  });

  it("doesn't repeat what the student already saw, nor announce old news on a new phone", async () => {
    seen({ c1: "approved" });
    trip(ch("c1", "Selfie gelato", "approved"), ch("c2", "Statue", "rejected"));
    renderAt("/challenges");
    await screen.findByRole("link", { name: /Statue/ });
    expect(toast()).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("entries-seen:t1")!)).toEqual({ c1: "approved", c2: "rejected" });
  });

  it("shows several decisions one after another", async () => {
    seen({ c1: "pending", c2: "pending" });
    trip(ch("c1", "Selfie gelato", "approved"), ch("c2", "Statue", "rejected"));
    const { user } = renderAt("/challenges");
    expect(await screen.findByRole("status", { name: "Notification" })).toHaveTextContent("Selfie gelato");
    await user.click(screen.getByRole("button", { name: "Fermer la notification" }));
    expect(screen.getByRole("status", { name: "Notification" })).toHaveTextContent("Statue");
    await user.click(screen.getByRole("button", { name: "Fermer la notification" }));
    expect(toast()).not.toBeInTheDocument();
  });

  it("only announces a decision, not a new entry waiting for one", async () => {
    seen({ c1: null });
    trip(ch("c1", "Selfie gelato", "pending"));
    renderAt("/challenges");
    await screen.findByRole("link", { name: /Selfie gelato/ });
    expect(toast()).not.toBeInTheDocument();
  });

  it("still works when the browser won't store anything (private mode)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    const list = trip(ch("c1", "Selfie gelato", "pending"));
    renderAt("/challenges");
    await screen.findByRole("link", { name: /Selfie gelato/ });
    list.challenges = [ch("c1", "Selfie gelato", "approved")];
    await comeBack();
    expect(await screen.findByRole("status", { name: "Notification" })).toHaveTextContent("Photo validée");
  });
});
