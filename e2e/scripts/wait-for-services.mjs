// Wait until Postgres, MinIO, Vault and Mailpit accept connections (CI and local).
// Usage: node e2e/scripts/wait-for-services.mjs [timeoutSeconds]
import net from "node:net";

const timeoutMs = Number(process.argv[2] ?? 90) * 1000;
const env = process.env;

const checks = [
  ["postgres", () => tcp(env.E2E_PG_HOST ?? "localhost", Number(env.E2E_PG_PORT ?? 5432))],
  ["minio", () => http(`${env.E2E_S3_ENDPOINT ?? "http://localhost:9000"}/minio/health/live`)],
  ["vault", () => http(`${env.E2E_VAULT_ADDR ?? "http://localhost:8200"}/v1/sys/health`)],
  ["mailpit", () => http(`${env.E2E_MAILPIT_URL ?? "http://localhost:8025"}/api/v1/info`)],
];

function tcp(host, port) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, host, () => { s.end(); resolve(); });
    s.on("error", reject);
    s.setTimeout(2000, () => { s.destroy(); reject(new Error("timeout")); });
  });
}

async function http(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
}

const deadline = Date.now() + timeoutMs;
for (const [name, check] of checks) {
  for (;;) {
    try {
      await check();
      console.log(`✓ ${name}`);
      break;
    } catch (e) {
      if (Date.now() > deadline) {
        console.error(`✗ ${name} not reachable: ${e.message}`);
        console.error("Start the services: docker compose -f docker-compose.dev.yml -f e2e/docker-compose.e2e.yml up -d");
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
// Postgres accepts TCP before the init script has loaded schema.sql; give it a beat.
await new Promise((r) => setTimeout(r, 2000));
