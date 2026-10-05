// #20: app logs must never carry student PII or bearer secrets.
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { Writable } from "node:stream";
import { loggerOptions } from "../src/lib/logging.js";

/** A Fastify app whose log lines are captured in memory. */
function capturedApp() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const app = Fastify({ logger: { ...loggerOptions("production"), stream } });
  return { app, lines };
}

describe("request logging", () => {
  it("logs request paths without their query string (invite tokens, codes)", async () => {
    const { app, lines } = capturedApp();
    app.get("/api/invites/preview", async () => ({ ok: true }));
    await app.inject({ method: "GET", url: "/api/invites/preview?token=super-secret-invite-token" });

    const all = lines.join("");
    expect(all).toContain("/api/invites/preview");
    expect(all).not.toContain("super-secret-invite-token");
  });

  it("redacts emails, codes, cookies and authorization anywhere in a log object", async () => {
    const { app, lines } = capturedApp();
    app.log.info({ email: "kid@school.test", nested: { code: "abc.def" } }, "event");
    await app.inject({ method: "GET", url: "/nope", headers: { cookie: "student_session=s3cret", authorization: "Bearer t0ken" } });

    const all = lines.join("");
    for (const secret of ["kid@school.test", "abc.def", "s3cret", "t0ken"]) expect(all).not.toContain(secret);
  });

  it("logs at info in production and debug elsewhere", () => {
    expect(loggerOptions("production").level).toBe("info");
    expect(loggerOptions("development").level).toBe("debug");
  });
});
