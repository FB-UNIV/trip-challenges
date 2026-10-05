// Logger options for Fastify (#20). Logs are keyed by opaque ids and must never carry
// student PII or bearer secrets, so they need no scrubbing at erasure time:
//  - request URLs are logged without their query string (invite tokens, challenge ids…);
//  - emails, access codes, cookies and authorization headers are redacted anywhere.
import type { FastifyServerOptions } from "fastify";

type LoggerOptions = Exclude<FastifyServerOptions["logger"], boolean | undefined> & { level: string };

export function loggerOptions(nodeEnv: string): LoggerOptions {
  return {
    level: nodeEnv === "production" ? "info" : "debug",
    // pino paths are exact depths: "*.email" does NOT cover a top-level `email` key.
    redact: [
      "req.headers.authorization", "req.headers.cookie",
      "email", "code", "*.email", "*.code", "*.*.email", "*.*.code",
    ],
    serializers: {
      // Same fields as Fastify's default serializer, minus the query string.
      req(req) {
        return {
          method: req.method,
          url: req.url.split("?", 1)[0],
          hostname: req.hostname,
          remoteAddress: req.ip,
        };
      },
    },
  };
}
