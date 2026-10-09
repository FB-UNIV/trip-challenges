import { config } from "./config.js";
import { ensureBucket, probeStorage } from "./storage/s3.js";
import { pool } from "./db.js";
import { migrate } from "./migrate.js";
import { ensureTransitEngine, probeKeystore } from "./crypto/vault.js";
import { startErasureScheduler } from "./scheduler.js";
import { buildServer } from "./app.js";

const app = await buildServer();

const applied = await migrate(pool); // before serving: the schema must be current
if (applied.length) app.log.info({ applied }, "schema migrations applied");
await ensureBucket();
await ensureTransitEngine();
// Fail fast if the credentials can't do everything the app (and erasure) needs (#69, #68).
// Each check throws a message naming the missing permission.
await probeStorage();
await probeKeystore();
startErasureScheduler();

app.listen({ host: "0.0.0.0", port: config.API_PORT }, (err, addr) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`api listening on ${addr}`);
});
