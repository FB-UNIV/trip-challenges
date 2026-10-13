// #104: a relay accepts mail for a mailbox that doesn't exist and only fails later, so the
// student stayed Invited forever. The API now asks Scaleway TEM for this project's failed
// emails and puts the matching student back to Undelivered, matched by the Message-ID we
// minted for their access-code mail — never by address (the address in TEM's answer is
// ignored, never logged or stored: ADR 0001).
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import { pollBounces, resetBouncePoll } from "../src/email/bounces.js";
import { config } from "./support/config.js";
import { pool, resetAll, makeTeacher, makeTrip, makeStudent } from "./support/harness.js";

const T0 = new Date("2026-10-13T10:00:00Z");
type TemEmail = { message_id: string; status: string; flags: string[]; mail_rcpt?: string };

let fetchMock: ReturnType<typeof vi.fn>;
/** Serve TEM ListEmails pages from a list (page_size honoured). */
function tem(emails: TemEmail[], status = 200) {
  fetchMock = vi.fn(async (url: string) => {
    if (status !== 200) return new Response(`{"message":"boom for kid@school.test"}`, { status });
    const u = new URL(url);
    const size = Number(u.searchParams.get("page_size"));
    const page = Number(u.searchParams.get("page"));
    const slice = emails.slice((page - 1) * size, page * size);
    return Response.json({ total_count: emails.length, emails: slice });
  });
  vi.stubGlobal("fetch", fetchMock);
}

let trip: string;
beforeEach(async () => {
  await resetAll();
  resetBouncePoll();
  Object.assign(config, { SCW_TEM_PROJECT_ID: "proj-1", SCW_TEM_SECRET_KEY: "scw-secret", SCW_TEM_REGION: "fr-par" });
  trip = await makeTrip(await makeTeacher(), { name: "Rome" });
});
afterEach(() => {
  Object.assign(config, { SCW_TEM_PROJECT_ID: undefined, SCW_TEM_SECRET_KEY: undefined });
  vi.unstubAllGlobals();
});

/** A student whose access-code mail went out with this Message-ID; signed in or not. */
async function mailed(messageId: string, joined = false) {
  const s = await makeStudent(trip);
  if (!joined) await pool.query(`DELETE FROM student_session WHERE student_id = $1`, [s.id]);
  await pool.query(
    `UPDATE student SET access_code_sent_at = now(), mail_message_id = $2 WHERE id = $1`, [s.id, messageId],
  );
  return s.id;
}
const state = async (id: string) =>
  (await pool.query<{ sent: boolean; mail_error: string | null }>(
    `SELECT access_code_sent_at IS NOT NULL AS sent, mail_error FROM student WHERE id = $1`, [id],
  )).rows[0]!;

describe("pollBounces", () => {
  it("does nothing when TEM isn't configured", async () => {
    Object.assign(config, { SCW_TEM_PROJECT_ID: undefined, SCW_TEM_SECRET_KEY: undefined });
    tem([]);
    expect(await pollBounces(T0)).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks TEM for this project's failed emails of the last days, authenticated", async () => {
    tem([]);
    await pollBounces(T0);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails");
    expect(u.searchParams.get("project_id")).toBe("proj-1");
    expect(u.searchParams.getAll("statuses")).toEqual(["failed"]);
    expect(new Date(u.searchParams.get("since")!).getTime()).toBeLessThan(T0.getTime() - 24 * 3600_000);
    expect((init.headers as Record<string, string>)["X-Auth-Token"]).toBe("scw-secret");
  });

  it("puts a student whose mail bounced back to Undelivered, with the reason", async () => {
    const lea = await mailed("<a1@pixexplore.test>");
    const tom = await mailed("<b2@pixexplore.test>");
    tem([{ message_id: "a1@pixexplore.test", status: "failed", flags: ["hard_bounce", "mailbox_not_found"], mail_rcpt: "lea@gmail.test" }]);

    expect(await pollBounces(T0)).toBe(1);
    expect(await state(lea)).toEqual({ sent: false, mail_error: "MAILBOX_NOT_FOUND" });
    expect(await state(tom)).toEqual({ sent: true, mail_error: null });
  });

  // Seen on staging: TEM reports our Message-ID's local part only, a bare UUID — no brackets,
  // no @domain — so a match on the whole header never found the student.
  it("matches TEM's bare Message-ID (no brackets, no domain) to the student", async () => {
    const lea = await mailed("<ddcf653b-510b-4301-9803-d14ac6674500@pixexplore.test>");
    tem([{ message_id: "ddcf653b-510b-4301-9803-d14ac6674500", status: "failed", flags: ["mailbox_not_found", "hard_bounce"] }]);

    expect(await pollBounces(T0)).toBe(1);
    expect(await state(lea)).toEqual({ sent: false, mail_error: "MAILBOX_NOT_FOUND" });
  });

  it("names the other reasons TEM gives", async () => {
    const full = await mailed("<full@x>");
    const block = await mailed("<block@x>");
    const other = await mailed("<other@x>");
    tem([
      { message_id: "<full@x>", status: "failed", flags: ["mailbox_full"] },
      { message_id: "<block@x>", status: "failed", flags: ["blocklisted"] },
      { message_id: "<other@x>", status: "failed", flags: [] },
    ]);
    await pollBounces(T0);
    expect((await state(full)).mail_error).toBe("MAILBOX_FULL");
    expect((await state(block)).mail_error).toBe("BLOCKLISTED");
    expect((await state(other)).mail_error).toBe("BOUNCED");
  });

  it("never touches a student who already joined (the code got through some other way)", async () => {
    const joined = await mailed("<j@x>", true);
    tem([{ message_id: "<j@x>", status: "failed", flags: ["mailbox_not_found"] }]);
    expect(await pollBounces(T0)).toBe(0);
    expect(await state(joined)).toEqual({ sent: true, mail_error: null });
  });

  it("ignores the bounce of an older mail once a new code went out", async () => {
    const lea = await mailed("<new@x>");
    tem([{ message_id: "<old@x>", status: "failed", flags: ["mailbox_not_found"] }]);
    expect(await pollBounces(T0)).toBe(0);
    expect((await state(lea)).sent).toBe(true);
  });

  it("reads every page", async () => {
    const failed: TemEmail[] = [];
    for (let i = 0; i < 120; i++) failed.push({ message_id: `<other-${i}@x>`, status: "failed", flags: [] });
    await mailed("<last@x>");
    failed.push({ message_id: "<last@x>", status: "failed", flags: ["mailbox_not_found"] });
    tem(failed);
    expect(await pollBounces(T0)).toBe(1);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("polls at most every 5 minutes", async () => {
    tem([]);
    await pollBounces(T0);
    await pollBounces(new Date(T0.getTime() + 60_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await pollBounces(new Date(T0.getTime() + 5 * 60_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails with the status only — TEM's body can echo a student's address", async () => {
    tem([], 500);
    const e = await pollBounces(T0).catch((x: Error) => x);
    expect(e).toBeInstanceOf(Error);
    expect(String((e as Error).message)).toContain("500");
    expect(String((e as Error).message)).not.toContain("@");
  });
});
