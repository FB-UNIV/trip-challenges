import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";

export async function healthRoutes(app: FastifyInstance) {
  // Liveness — is the process up?
  app.get("/api/healthz", async () => ({ status: "ok" }));

  // Readiness — can we serve traffic? (used by the proxy/orchestrator)
  app.get("/api/readyz", async (_req, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not-ready" });
    }
  });
}
