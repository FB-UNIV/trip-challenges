// Stand-in for the `pg` module, backed by PGlite (in-process WASM Postgres) running the
// real db/schema.sql. src/db.ts stays unmodified, so pool.query / tx() execute real SQL.
// Mock with: vi.mock("pg", () => import("./support/fake-pg.js"))
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8");

export const db = new PGlite({ extensions: { citext, pgcrypto } });
const ready = db.exec(schema);

// node-postgres returns bytea as Buffer; PGlite returns Uint8Array. The app calls
// Buffer#toString("utf8") on bytea columns, so convert to match production.
const toBuffer = (v: unknown) =>
  v instanceof Uint8Array && !Buffer.isBuffer(v) ? Buffer.from(v) : v;

async function query(text: string, params?: unknown[]) {
  await ready;
  const r = await db.query<Record<string, unknown>>(text, params);
  const rows = r.rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, toBuffer(v)])),
  );
  // pg's rowCount is rows returned for SELECT and rows affected for writes.
  return { rows, rowCount: Math.max(r.affectedRows ?? 0, rows.length) };
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
