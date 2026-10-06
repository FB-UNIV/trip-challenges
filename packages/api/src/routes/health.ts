import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { guard } from "../auth/guard.js";

export async function healthRoutes(app: FastifyInstance) {
  const open = { preHandler: guard({ role: "public" }) };

  // Liveness — is the process up?
  app.get("/api/healthz", open, async () => ({ status: "ok" }));

  // Readiness — can we serve traffic? (used by the proxy/orchestrator)
  app.get("/api/readyz", open, async (_req, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not-ready" });
    }
  });
}
