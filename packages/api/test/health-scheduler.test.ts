import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import { healthRoutes } from "../src/routes/health.js";
import { startErasureScheduler } from "../src/scheduler.js";
import { enqueueRoster } from "../src/roster-worker.js";
import { hasKey, faults } from "./support/fake-vault.js";
import { s3faults } from "./support/fake-s3.js";
import { sent } from "./support/fake-mailer.js";
import { pool, resetAll, buildApp, makeTeacher, makeTrip, addCoTeacher, count } from "./support/harness.js";

beforeEach(resetAll);

describe("health", () => {
  it("reports liveness and DB readiness", async () => {
    const app = await buildApp([healthRoutes]);
    expect((await app.inject({ method: "GET", url: "/api/healthz" })).json()).toEqual({ status: "ok" });
    expect((await app.inject({ method: "GET", url: "/api/readyz" })).json()).toEqual({ status: "ready" });

    const down = vi.spyOn(pool, "query").mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await app.inject({ method: "GET", url: "/api/readyz" });
    down.mockRestore();
    expect(res.statusCode).toBe(503);
  });
});

describe("startErasureScheduler", () => {
  let timer: ReturnType<typeof startErasureScheduler> | undefined;
  afterEach(async () => {
    clearInterval(timer);
    // A tick already in flight keeps running after clearInterval; let it finish so it
    // can't drain or erase the next test's data.
    await new Promise((r) => setTimeout(r, 100));
    vi.restoreAllMocks();
  });

  it("each tick erases due trips and drains the roster queue", async () => {
    const owner = await makeTeacher();
    const due = await makeTrip(owner, { phase: "challenge", hardEraseAt: new Date(Date.now() - 1000) });
    const live = await makeTrip(owner, { phase: "challenge", hardEraseAt: new Date(Date.now() + 30 * 86_400_000) });
    await enqueueRoster(live, ["kid@school.test"]);

    timer = startErasureScheduler(20);

    await vi.waitFor(async () => {
      expect(hasKey(due)).toBe(false);
      expect(await count("student", "trip_id = $1", [live])).toBe(1);
    }, { timeout: 10_000 });
    expect(hasKey(live)).toBe(true);
  });

  it("still drains the roster when another replica holds the erasure lock (#37)", async () => {
    // Every connection the scheduler opens from now on reports the erasure lock as held
    // by another replica; we record which advisory locks those connections try.
    const ERASURE_LOCK = 918273645, ROSTER_LOCK = 553311;
    const tried: number[] = [];
    const realConnect = pool.connect.bind(pool);
    vi.spyOn(pool, "connect").mockImplementation((async () => {
      const c = await realConnect();
      return {
        ...c,
        query: async (sql: string, params?: unknown[]) => {
          if (sql.includes("pg_try_advisory_lock")) tried.push(params?.[0] as number);
          return sql.includes("pg_try_advisory_lock") && params?.[0] === ERASURE_LOCK
            ? { rows: [{ locked: false }], rowCount: 1 }
            : c.query(sql, params as any);
        },
      };
    }) as any);

    timer = startErasureScheduler(20);
    await vi.waitFor(() => expect(tried).toContain(ERASURE_LOCK), { timeout: 10_000 });
    // A tick that lost the erasure lock must still go on to drain the roster.
    await vi.waitFor(() => expect(tried).toContain(ROSTER_LOCK), { timeout: 10_000 });
  });

  it("logs a trip whose erasure fails and keeps ticking", async () => {
    const due = await makeTrip(await makeTeacher(), { phase: "challenge", hardEraseAt: new Date(Date.now() - 1000) });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    faults.destroyKeyFailures = 1; // e.g. Vault sealed for one tick

    timer = startErasureScheduler(20);
    await vi.waitFor(() => expect(err).toHaveBeenCalledWith(`[erasure] failed for trip ${due}`, expect.any(Error)), { timeout: 10_000 });
    await vi.waitFor(() => expect(hasKey(due)).toBe(false), { timeout: 10_000 }); // finished on a later tick
  });

  // #19: a DB blip used to escape `void tick()` as an unhandled rejection, which kills
  // the Node process (and every replica hits the same blip).
  describe("survives a database outage during a tick (#19)", () => {
    let unhandled: unknown[];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    beforeEach(() => {
      unhandled = [];
      process.on("unhandledRejection", onUnhandled);
    });
    afterEach(() => {
      process.off("unhandledRejection", onUnhandled);
    });

    async function expectRecovers(due: string, err: ReturnType<typeof vi.spyOn>) {
      await vi.waitFor(() => expect(err).toHaveBeenCalledWith("[scheduler] tick failed", expect.any(Error)), { timeout: 10_000 });
      await vi.waitFor(() => expect(hasKey(due)).toBe(false), { timeout: 10_000 }); // a later tick still does the work
      expect(unhandled).toEqual([]);
    }

    it("when the pool can't hand out a connection", async () => {
      const due = await makeTrip(await makeTeacher(), { phase: "challenge", hardEraseAt: new Date(Date.now() - 1000) });
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(pool, "connect").mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

      timer = startErasureScheduler(20);
      await expectRecovers(due, err);
    });

    it("when finding due trips fails (and the advisory lock is still released)", async () => {
      const due = await makeTrip(await makeTeacher(), { phase: "challenge", hardEraseAt: new Date(Date.now() - 1000) });
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      const realQuery = pool.query.bind(pool);
      let failed = false;
      vi.spyOn(pool, "query").mockImplementation((async (sql: string, params?: unknown[]) => {
        if (!failed && sql.includes("FROM trip") && sql.includes("hard_erase_at <=")) {
          failed = true;
          throw new Error("terminating connection due to administrator command");
        }
        return realQuery(sql, params as any);
      }) as any);

      timer = startErasureScheduler(20);
      await expectRecovers(due, err);
    });
  });

});

describe("erasure alerting and heartbeat (#24)", () => {
  let timer: ReturnType<typeof startErasureScheduler> | undefined;
  let pings: string[];
  beforeEach(() => {
    pings = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      pings.push(url);
      return new Response("OK");
    }));
  });
  afterEach(() => {
    clearInterval(timer);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("emails the trip's teachers and the ops address when erasure fails, at most hourly", async () => {
    const owner = await makeTeacher("owner@school.test");
    const due = await makeTrip(owner, { name: "Rome", phase: "challenge", hardEraseAt: new Date(Date.now() - 1000) });
    await addCoTeacher(due, await makeTeacher("co@school.test"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    s3faults.deleteFailures = 3; // three ticks in a row fail

    timer = startErasureScheduler(20);
    await vi.waitFor(() => expect(hasKey(due)).toBe(false)); // 4th tick succeeds

    const alerts = sent.filter((m) => m.kind === "erasure_failed");
    expect(alerts.map((m) => m.to).sort()).toEqual(["co@school.test", "ops@school.test", "owner@school.test"]);
    expect(alerts[0]!.args).toEqual(["Rome", due, expect.stringContaining("SlowDown")]);
  });

  it("pings the heartbeat after a healthy tick", async () => {
    timer = startErasureScheduler(20);
    await vi.waitFor(() => expect(pings).toContain("http://heartbeat.test/ping"));
  });

  it("withholds the heartbeat while an erasure is failing, so the monitor alerts", async () => {
    await makeTrip(await makeTeacher(), { phase: "challenge", hardEraseAt: new Date(Date.now() - 1000) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    s3faults.deleteFailures = 1_000;

    timer = startErasureScheduler(20);
    await vi.waitFor(() => expect(sent.some((m) => m.kind === "erasure_failed")).toBe(true));
    await new Promise((r) => setTimeout(r, 100)); // several more failing ticks
    expect(pings).toEqual([]);
  });
});
