import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { guard } from "../auth/guard.js";
import { keystoreHealth } from "../crypto/vault.js";
import { storageHealth } from "../storage/s3.js";

export async function healthRoutes(app: FastifyInstance) {
  const open = { preHandler: guard({ role: "public" }) };

  // Liveness — is the process up?
  app.get("/api/healthz", open, async () => ({ status: "ok" }));

  // Readiness: can we serve traffic? (used by the proxy/orchestrator). Says which dependency
  // is down (#69), never why in detail: no hosts, codes or secrets on a public endpoint.
  app.get("/api/readyz", open, async (_req, reply) => {
    const [database, keystore, storage] = await Promise.all([
      pool.query("SELECT 1").then(() => "ok" as const, () => "down" as const),
      keystoreHealth(),
      storageHealth(),
    ]);
    const checks = { database, keystore, storage };
    const ready = database === "ok" && keystore === "ok" && storage === "ok";
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "not-ready", checks });
  });
}
