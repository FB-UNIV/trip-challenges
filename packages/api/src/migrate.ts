// Schema migrations (#23). Numbered SQL files in db/migrations/ ("0002_add_x.sql"),
// applied in filename order, each in its own transaction, recorded in schema_migrations.
// Runs at API boot under an advisory lock, so concurrent replicas don't race.
//
// Rule: never edit a migration that has shipped; add a new numbered file instead.
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

type Client = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
  release: () => void;
};
type Pool = { connect: () => Promise<Client> };

export const MIGRATIONS_DIR = fileURLToPath(new URL("../db/migrations/", import.meta.url));
/** The schema as first deployed from db/schema.sql (docker-entrypoint-initdb). */
export const BASELINE = "0001_baseline";
const LOCK_KEY = 730_001; // advisory lock, distinct from the scheduler's keys
const FILE = /^(\d{4}_[\w-]+)\.sql$/;

/** Apply pending migrations; returns the versions applied by this run. */
export async function migrate(pool: Pool, { dir = MIGRATIONS_DIR }: { dir?: string } = {}): Promise<string[]> {
  // Advisory locks are per session: hold one connection for the whole run.
  const c = await pool.connect();
  try {
    await c.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    try {
      await c.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           version    text PRIMARY KEY,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
      const done = new Set((await c.query(`SELECT version FROM schema_migrations`)).rows.map((r) => r.version as string));

      // A database created from the old schema.sql has the tables but no history:
      // adopt it at the baseline instead of re-running (and failing on) CREATE TABLE.
      if (done.size === 0 && (await tableExists(c, "trip"))) {
        await c.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [BASELINE]);
        done.add(BASELINE);
      }

      const pending = (await readdir(dir))
        .map((f) => FILE.exec(f)?.[1])
        .filter((v): v is string => !!v && !done.has(v))
        .sort();

      for (const version of pending) {
        const sql = await readFile(join(dir, `${version}.sql`), "utf8");
        await c.query("BEGIN");
        try {
          await c.query(sql);
          await c.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [version]);
          await c.query("COMMIT");
        } catch (e) {
          await c.query("ROLLBACK");
          throw new Error(`migration ${version} failed: ${(e as Error).message}`, { cause: e });
        }
      }
      return pending;
    } finally {
      await c.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
    }
  } finally {
    c.release();
  }
}

async function tableExists(c: Client, name: string): Promise<boolean> {
  const { rows } = await c.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [name],
  );
  return rows.length > 0;
}
