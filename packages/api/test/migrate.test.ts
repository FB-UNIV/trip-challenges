// Schema migration runner (#23). Each test gets its own in-process Postgres, so the
// runner is exercised against real DDL, transactions and advisory locks.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { mkdtemp, writeFile, readFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, MIGRATIONS_DIR, BASELINE } from "../src/migrate.js";

let pg: PGlite;
let log: string[];

/** pg-style pool over a PGlite instance, recording every statement. */
function poolOf(db: PGlite) {
  const query = async (text: string, params?: unknown[]) => {
    log.push(text.trim().split("\n")[0]!);
    if (params?.length) {
      const r = await db.query(text, params);
      return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length };
    }
    const results = await db.exec(text); // multi-statement (migration files)
    const last = results.at(-1);
    return { rows: (last?.rows ?? []) as any[], rowCount: last?.affectedRows ?? last?.rows.length ?? 0 };
  };
  return { connect: async () => ({ query, release() {} }) };
}

const versions = async () =>
  (await pg.query<{ version: string }>(`SELECT version FROM schema_migrations ORDER BY version`)).rows.map((r) => r.version);
const tableExists = async (name: string) =>
  (await pg.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`, [name])).rows.length === 1;

/** A migrations dir containing the real baseline plus extra test migrations. */
async function dirWith(extra: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "migrations-"));
  await copyFile(join(MIGRATIONS_DIR, `${BASELINE}.sql`), join(dir, `${BASELINE}.sql`));
  for (const [name, sql] of Object.entries(extra)) await writeFile(join(dir, name), sql);
  return dir;
}

const dirs: string[] = [];
beforeEach(async () => {
  pg = new PGlite({ extensions: { citext, pgcrypto } });
  log = [];
});
afterEach(async () => {
  await pg.close();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("migrate", () => {
  it("builds a fresh database from the migrations and records them", async () => {
    const applied = await migrate(poolOf(pg));
    expect(applied[0]).toBe(BASELINE);
    expect(await versions()).toEqual(applied);
    for (const t of ["trip", "student", "submission", "erasure_warning", "roster_import_item"]) {
      expect(await tableExists(t), t).toBe(true);
    }
  });

  it("is a no-op when everything is already applied", async () => {
    await migrate(poolOf(pg));
    expect(await migrate(poolOf(pg))).toEqual([]);
  });

  it("applies only pending migrations, in filename order, skipping non-migration files", async () => {
    const dir = await dirWith({
      "0003_c.sql": "ALTER TABLE trip ADD COLUMN c int;",
      "0002_b.sql": "ALTER TABLE trip ADD COLUMN b int;",
      "README.md": "not a migration",
    });
    dirs.push(dir);
    expect(await migrate(poolOf(pg), { dir })).toEqual([BASELINE, "0002_b", "0003_c"]);
    expect(await versions()).toEqual([BASELINE, "0002_b", "0003_c"]);
  });

  it("adopts a database created from the old schema.sql without re-running the baseline", async () => {
    // Production today: tables exist (docker-entrypoint-initdb ran schema.sql), no history.
    await pg.exec(await readFile(join(MIGRATIONS_DIR, `${BASELINE}.sql`), "utf8"));
    const dir = await dirWith({ "0002_b.sql": "ALTER TABLE trip ADD COLUMN b int;" });
    dirs.push(dir);

    expect(await migrate(poolOf(pg), { dir })).toEqual(["0002_b"]);
    expect(await versions()).toEqual([BASELINE, "0002_b"]);
  });

  it("rolls back a failing migration, names it, and releases the lock", async () => {
    const dir = await dirWith({ "0002_bad.sql": "CREATE TABLE half_done (id int);\nSELECT 1/0;" });
    dirs.push(dir);

    await expect(migrate(poolOf(pg), { dir })).rejects.toThrow(/0002_bad/);
    expect(await tableExists("half_done")).toBe(false);
    expect(await versions()).toEqual([BASELINE]);
    expect(log.some((q) => q.startsWith("SELECT pg_advisory_unlock"))).toBe(true);
  });

  it("serialises runners with an advisory lock", async () => {
    await migrate(poolOf(pg));
    const lock = log.findIndex((q) => q.startsWith("SELECT pg_advisory_lock"));
    const unlock = log.findIndex((q) => q.startsWith("SELECT pg_advisory_unlock"));
    expect(lock).toBe(0);
    expect(unlock).toBe(log.length - 1);
  });
});
