// #69: every error response is { error, message, requestId }; dependency failures are 503s
// that say which dependency is down; logs carry the route pattern, never PII.
import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { Writable } from "node:stream";
import { loggerOptions } from "../src/lib/logging.js";
import { installErrorHandling, requestIdOptions, tagDependency } from "../src/lib/errors.js";

const thrown = new Map<string, () => unknown>([
  ["unknown", () => new Error("secret internal detail")],
  ["s3", () => Object.assign(new Error("Access Denied."), { name: "AccessDenied", $fault: "client", $metadata: { httpStatusCode: 403 } })],
  ["vault-sealed", () => tagDependency(Object.assign(new Error("vault -> 503 sealed"), { status: 503 }), "keystore")],
  ["vault-network", () => tagDependency(new TypeError("fetch failed"), "keystore")],
  ["vault-bad-request", () => tagDependency(Object.assign(new Error("vault -> 400 bad ciphertext"), { status: 400 }), "keystore")],
  ["pg-refused", () => Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), { code: "ECONNREFUSED" })],
  ["pg-terminated", () => Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01", severity: "FATAL" })],
  ["pg-unique", () => Object.assign(new Error('duplicate key value violates unique constraint "team_name"'), {
    code: "23505", severity: "ERROR", detail: "Key (name)=(Léa & Tom 4B) already exists.",
  })],
  ["too-large", () => Object.assign(new Error("request file too large"), { statusCode: 413, code: "FST_REQ_FILE_TOO_LARGE" })],
  ["rate-limited", () => ({ statusCode: 429, error: "rate_limited", message: "Too many requests — try again in 1 minute." })],
]);

async function app(): Promise<{ app: FastifyInstance; logs: () => any[] }> {
  const lines: string[] = [];
  const stream = new Writable({ write(chunk, _e, cb) { lines.push(chunk.toString()); cb(); } });
  const a = Fastify({ logger: { ...loggerOptions("production"), stream }, ...requestIdOptions });
  installErrorHandling(a);
  a.get("/boom/:kind", async (req) => { throw thrown.get((req.params as { kind: string }).kind)!(); });
  a.get("/refused", async (_req, reply) => reply.code(409).send({ error: "conflict", message: "Already there." }));
  a.get("/forbidden", async (_req, reply) => reply.code(403).send({ error: "forbidden", message: "Not yours." }));
  a.get("/fine", async () => ({ ok: true }));
  await a.ready();
  return { app: a, logs: () => lines.map((l) => JSON.parse(l)) };
}

describe("error responses", () => {
  it("hide unknown errors behind internal_error, with a reference", async () => {
    const { app: a } = await app();
    const res = await a.inject({ method: "GET", url: "/boom/unknown" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "internal_error", message: expect.any(String), requestId: res.headers["x-request-id"] });
    expect(res.body).not.toContain("secret internal detail");
    expect(res.body).not.toContain("at ");
  });

  it.each([
    ["s3", "storage_unavailable"],
    ["vault-sealed", "keystore_unavailable"],
    ["vault-network", "keystore_unavailable"],
    ["pg-refused", "database_unavailable"],
    ["pg-terminated", "database_unavailable"],
  ])("map a %s failure to 503 %s", async (kind, error) => {
    const { app: a } = await app();
    const res = await a.inject({ method: "GET", url: `/boom/${kind}` });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error, requestId: expect.any(String) });
    expect(res.json().message).toMatch(/unavailable/i);
  });

  it.each(["vault-bad-request", "pg-unique"])("treat a %s (our bug, not an outage) as internal_error", async (kind) => {
    const { app: a } = await app();
    const res = await a.inject({ method: "GET", url: `/boom/${kind}` });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("internal_error");
    expect(res.body).not.toContain("Léa");
  });

  it("keep a client error's status and say what it was", async () => {
    const { app: a } = await app();
    const res = await a.inject({ method: "GET", url: "/boom/too-large" });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: "payload_too_large", message: "request file too large", requestId: expect.any(String) });
  });

  it("keep the rate limiter's own code and message", async () => {
    const { app: a } = await app();
    const res = await a.inject({ method: "GET", url: "/boom/rate-limited" });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: "rate_limited", message: "Too many requests — try again in 1 minute." });
  });

  it("add the reference to errors a route sends itself", async () => {
    const { app: a } = await app();
    const res = await a.inject({ method: "GET", url: "/refused" });
    expect(res.json()).toEqual({ error: "conflict", message: "Already there.", requestId: res.headers["x-request-id"] });
  });

  it("answer an unknown route with not_found", async () => {
    const { app: a } = await app();
    const res = await a.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "not_found", requestId: expect.any(String) });
  });

  it("leave successful bodies alone", async () => {
    const { app: a } = await app();
    expect((await a.inject({ method: "GET", url: "/fine" })).json()).toEqual({ ok: true });
  });
});

describe("request ids", () => {
  it("honour the proxy's X-Request-Id and echo it back", async () => {
    const { app: a } = await app();
    const res = await a.inject({ method: "GET", url: "/fine", headers: { "x-request-id": "traefik-abc_123" } });
    expect(res.headers["x-request-id"]).toBe("traefik-abc_123");
  });

  it.each([
    ["missing", undefined],
    ["unsafe", "abc\"def"],
    ["too long", "x".repeat(200)],
  ])("generate one when the incoming id is %s", async (_label, id) => {
    const { app: a } = await app();
    const res = await a.inject({ method: "GET", url: "/fine", headers: id ? { "x-request-id": id } : {} });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("are unique per request", async () => {
    const { app: a } = await app();
    const [r1, r2] = await Promise.all([a.inject("/fine"), a.inject("/fine")]);
    expect(r1.headers["x-request-id"]).not.toBe(r2.headers["x-request-id"]);
  });
});

describe("error logs", () => {
  it("log a 5xx at error with route pattern, status, dependency and code, under the request id", async () => {
    const { app: a, logs } = await app();
    const res = await a.inject({ method: "GET", url: "/boom/s3" });
    const line = logs().find((l) => l.level === 50)!;
    expect(line).toMatchObject({
      reqId: res.headers["x-request-id"], route: "/boom/:kind", status: 503, dependency: "storage", errorCode: "AccessDenied",
    });
  });

  it("never log a database error's detail (it can quote row values)", async () => {
    const { app: a, logs } = await app();
    await a.inject({ method: "GET", url: "/boom/pg-unique" });
    const line = logs().find((l) => l.level === 50)!;
    expect(line).toMatchObject({ status: 500, errorCode: "23505" });
    expect(JSON.stringify(logs())).not.toContain("Léa");
  });

  it("log misuse (403, 429) at warn, other client errors not at all", async () => {
    const { app: a, logs } = await app();
    await a.inject({ method: "GET", url: "/forbidden" });
    await a.inject({ method: "GET", url: "/boom/rate-limited" });
    await a.inject({ method: "GET", url: "/refused" });
    const warns = logs().filter((l) => l.level === 40);
    expect(warns.map((l) => l.status)).toEqual([403, 429]);
    expect(logs().filter((l) => l.level >= 50)).toEqual([]);
  });
});
