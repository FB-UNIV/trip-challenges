// Stand-in for the `pg` module, backed by PGlite (in-process WASM Postgres) with the
// schema built by the real migration runner (src/migrate.ts). src/db.ts stays unmodified,
// so pool.query / tx() execute real SQL.
// Mock with: vi.mock("pg", () => import("./support/fake-pg.js"))
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { migrate } from "../../src/migrate.js";

export const db = new PGlite({ extensions: { citext, pgcrypto } });

// node-postgres returns bytea as Buffer; PGlite returns Uint8Array. The app calls
// Buffer#toString("utf8") on bytea columns, so convert to match production.
const toBuffer = (v: unknown) =>
  v instanceof Uint8Array && !Buffer.isBuffer(v) ? Buffer.from(v) : v;

/** One statement with params (extended protocol), or a multi-statement script without. */
async function raw(text: string, params?: unknown[]) {
  const r = params?.length
    ? await db.query<Record<string, unknown>>(text, params)
    : ((await db.exec(text)).at(-1) ?? { rows: [], affectedRows: 0 });
  const rows = (r.rows as Record<string, unknown>[]).map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, toBuffer(v)])),
  );
  // pg's rowCount is rows returned for SELECT and rows affected for writes.
  return { rows, rowCount: Math.max(r.affectedRows ?? 0, rows.length) };
}

const ready = migrate({ connect: async () => ({ query: raw, release() {} }) });

async function query(text: string, params?: unknown[]) {
  await ready;
  return raw(text, params);
}

class Pool {
  query = query;
  async connect() {
    return { query, release() {} };
  }
}

export default { Pool };

let tables: string[] | null = null;

/** Wipe every table between tests (schema stays loaded). */
export async function resetDb(): Promise<void> {
  await ready;
  tables ??= (
    await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    )
  ).rows.map((r) => r.tablename);
  await db.exec(`TRUNCATE ${tables.join(", ")} CASCADE`);
}
