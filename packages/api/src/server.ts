import { config } from "./config.js";
import { ensureBucket } from "./storage/s3.js";
import { pool } from "./db.js";
import { migrate } from "./migrate.js";
import { ensureTransitEngine } from "./crypto/vault.js";
import { startErasureScheduler } from "./scheduler.js";
import { buildServer } from "./app.js";

const app = await buildServer();

const applied = await migrate(pool); // before serving: the schema must be current
if (applied.length) app.log.info({ applied }, "schema migrations applied");
await ensureBucket();
await ensureTransitEngine();
startErasureScheduler();

app.listen({ host: "0.0.0.0", port: config.API_PORT }, (err, addr) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`api listening on ${addr}`);
});
