import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import { healthRoutes } from "../src/routes/health.js";
import { startErasureScheduler } from "../src/scheduler.js";
import { enqueueRoster } from "../src/roster-worker.js";
import { hasKey } from "./support/fake-vault.js";
import { pool, resetAll, buildApp, makeTeacher, makeTrip, count } from "./support/harness.js";

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
  afterEach(() => {
    clearInterval(timer);
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
    });
    expect(hasKey(live)).toBe(true);
  });

  it("logs a trip whose erasure fails and keeps ticking", async () => {
    const due = await makeTrip(await makeTeacher(), { phase: "challenge", hardEraseAt: new Date(Date.now() - 1000) });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const realQuery = pool.query.bind(pool);
    vi.spyOn(pool, "query").mockImplementation((async (sql: string, params?: unknown[]) => {
      if (sql.includes("'erasure_fired'")) throw new Error("audit insert failed");
      return realQuery(sql, params as any);
    }) as any);

    timer = startErasureScheduler(20);
    await vi.waitFor(() => expect(err).toHaveBeenCalledWith(`[erasure] failed for trip ${due}`, expect.any(Error)));
  });
});
