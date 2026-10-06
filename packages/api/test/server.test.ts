// The real HTTP wiring (src/app.ts): proxy trust and rate limits (#67).
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/app.js";
import { config } from "./support/config.js";
import { resetAll, makeTeacher, makeTrip, makeStudent } from "./support/harness.js";

// Each test gets a fresh server, so rate-limit buckets start empty.
let app: FastifyInstance;
beforeEach(async () => {
  await resetAll();
  app = await buildServer();
  await app.ready();
});

const TRAEFIK = "172.18.0.5"; // the proxy, on the internal docker network
const health = (headers: Record<string, string>, remoteAddress = TRAEFIK) =>
  app.inject({ method: "GET", url: "/api/healthz", headers, remoteAddress });

describe("buildServer", () => {
  it("serves the API routes", async () => {
    expect((await health({})).json()).toEqual({ status: "ok" });
    expect((await app.inject({ method: "GET", url: "/api/student/me" })).statusCode).toBe(401);
  });
});

describe("behind the proxy (#67)", () => {
  it("rate-limits each client by its forwarded IP, not the whole school as one", async () => {
    const max = config.RATE_LIMIT_MAX;
    for (let i = 0; i < max; i++) expect((await health({ "x-forwarded-for": "203.0.113.1" })).statusCode).toBe(200);
    const limited = await health({ "x-forwarded-for": "203.0.113.1" });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: "rate_limited" });
    expect(limited.json().message).toMatch(/try again/i);

    // Another phone behind the same proxy is unaffected.
    expect((await health({ "x-forwarded-for": "203.0.113.2" })).statusCode).toBe(200);
  });

  it("ignores X-Forwarded-For from a client that isn't a trusted proxy (no spoofing out of the limit)", async () => {
    const outsider = "198.51.100.7";
    for (let i = 0; i < config.RATE_LIMIT_MAX; i++) {
      await health({ "x-forwarded-for": `203.0.113.${i + 10}` }, outsider);
    }
    expect((await health({ "x-forwarded-for": "203.0.113.250" }, outsider)).statusCode).toBe(429);
  });
});

describe("access-code redemption limits (#67)", () => {
  const redeem = (code: string, ip = "203.0.113.9") =>
    app.inject({
      method: "POST", url: "/api/student/redeem", remoteAddress: TRAEFIK,
      headers: { "x-forwarded-for": ip }, payload: { code },
    });

  it("lets a whole class on one school Wi-Fi join at once", { timeout: 60_000 }, async () => {
    const owner = await makeTeacher();
    const trip = await makeTrip(owner);
    const kids = await Promise.all(
      Array.from({ length: config.RATE_LIMIT_AUTH_MAX * 3 }, () => makeStudent(trip, { unredeemedCode: true })),
    );
    const statuses = [];
    for (const kid of kids) statuses.push((await redeem(kid.code!)).statusCode);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it("still throttles repeated guesses at one access code, from any IP", async () => {
    const owner = await makeTeacher();
    const trip = await makeTrip(owner);
    const kid = await makeStudent(trip, { unredeemedCode: true });
    const id = kid.code!.split(".")[0];
    const statuses = [];
    for (let i = 0; i <= config.RATE_LIMIT_AUTH_MAX; i++) {
      statuses.push((await redeem(`${id}.wrong-guess-${i}`, `203.0.113.${100 + i}`)).statusCode);
    }
    expect(statuses.slice(0, -1).every((s) => s !== 429)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
