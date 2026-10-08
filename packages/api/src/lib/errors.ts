// One error shape for every response (#69): { error, message, requestId }. Known dependency
// outages become 503s naming the dependency; anything else unexpected is a 500 with no detail.
// The requestId is in the body and the X-Request-Id header, and on every log line (reqId),
// so a user's "Reference: …" finds the operator's log entry in one search.
//
// Logs carry the route pattern, never the URL, and never an error's own fields beyond
// name/code/message/stack: Postgres puts row values in `detail` (ADR 0001, #20).
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";

export type Dependency = "storage" | "keystore" | "database";

/** Mark an error as coming from a dependency, so the handler can say which one is down. */
export function tagDependency<E>(err: E, dependency: Dependency): E {
  if (err && typeof err === "object") Object.assign(err, { dependency });
  return err;
}

// Accept the proxy's id only if it is short and plain, so it can't forge or break log lines.
const SAFE_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export const requestIdOptions = {
  requestIdHeader: false as const,
  genReqId(req: IncomingMessage): string {
    const incoming = req.headers["x-request-id"];
    return typeof incoming === "string" && SAFE_ID.test(incoming) ? incoming : randomUUID();
  },
};

const UNAVAILABLE: Record<Dependency, string> = {
  storage: "Photo storage is unavailable right now. Try again in a moment.",
  keystore: "The encryption service is unavailable right now. Try again in a moment.",
  database: "The database is unavailable right now. Try again in a moment.",
};

const CLIENT_ERRORS: Record<number, string> = {
  400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed",
  409: "conflict", 413: "payload_too_large", 415: "unsupported_media_type", 429: "rate_limited",
};

// Socket-level failures. Storage and keystore errors are tagged at their client, so an
// untagged one can only come from the Postgres driver.
const NETWORK = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "EPIPE"]);
// SQLSTATE classes that mean "the server can't serve us", not "our query was wrong":
// 08 connection exception, 53 insufficient resources, 57P operator intervention/shutdown.
const PG_OUTAGE = /^(08|53|57P)/;
const KEYSTORE_OUTAGE = new Set([403, 429, 500, 502, 503, 504]);

type Loose = { [k: string]: unknown; name?: string; message?: string; code?: unknown; stack?: string };
type Classified = { status: number; error: string; message: string; dependency?: Dependency };

function outage(err: Loose): Dependency | undefined {
  const code = typeof err.code === "string" ? err.code : "";
  switch (err.dependency) {
    case "storage":
      return "storage";
    case "keystore":
      // No status: Vault was unreachable. 403: token revoked/expired. 5xx: sealed or down.
      return typeof err.status !== "number" || KEYSTORE_OUTAGE.has(err.status) ? "keystore" : undefined;
  }
  // AWS SDK errors carry $metadata; a client without our tagging middleware still counts.
  if (err.$metadata) return "storage";
  if (NETWORK.has(code)) return "database";
  if (err.severity && PG_OUTAGE.test(code)) return "database";
  if (/Connection terminated|timeout exceeded when trying to connect/.test(err.message ?? "")) return "database";
  return undefined;
}

export function classifyError(err: Loose): Classified {
  const status = Number(err.statusCode);
  if (status >= 400 && status < 500) {
    const own = typeof err.error === "string" && /^[a-z_]+$/.test(err.error) ? err.error : undefined;
    return { status, error: own ?? CLIENT_ERRORS[status] ?? "request_failed", message: err.message || "Request failed." };
  }
  const dependency = outage(err);
  if (dependency) return { status: 503, error: `${dependency}_unavailable`, message: UNAVAILABLE[dependency], dependency };
  return { status: 500, error: "internal_error", message: "Something went wrong on our side." };
}

const routeOf = (req: FastifyRequest) => req.routeOptions?.url;

export function installErrorHandling(app: FastifyInstance): void {
  app.addHook("onRequest", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });

  // Errors a route sends itself ({ error, message }) get the reference too.
  app.addHook("preSerialization", async (req, reply: FastifyReply, payload: unknown) => {
    if (
      reply.statusCode >= 400 && payload && typeof payload === "object" && !Array.isArray(payload)
      && "error" in payload && !("requestId" in payload)
    ) {
      return { ...payload, requestId: req.id };
    }
    return payload;
  });

  // Misuse worth noticing (someone probing, or a class hammering the API).
  app.addHook("onResponse", async (req, reply) => {
    if (reply.statusCode === 403 || reply.statusCode === 429) {
      req.log.warn({ route: routeOf(req), status: reply.statusCode }, "request refused");
    }
  });

  app.setErrorHandler((e: FastifyError, req, reply) => {
    const err = e as unknown as Loose;
    const out = classifyError(err);
    if (out.status >= 500) {
      req.log.error(
        {
          route: routeOf(req),
          status: out.status,
          dependency: out.dependency,
          errorCode: typeof err.code === "string" ? err.code : err.name, // not `code`: redacted (access codes)
          // Not the raw error: drivers attach row values (pg `detail`) we must not log.
          err: { type: err.name, message: err.message, stack: err.stack },
        },
        `${out.error}: ${err.message ?? "unknown error"}`,
      );
    }
    return reply.code(out.status).send({ error: out.error, message: out.message, requestId: req.id });
  });

  app.setNotFoundHandler((req, reply) => {
    return reply.code(404).send({ error: "not_found", message: "No such endpoint.", requestId: req.id });
  });
}
