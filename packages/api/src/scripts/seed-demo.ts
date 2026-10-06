// Staging demo data. Run inside the api container, e.g.:
//   docker compose exec -e SEED_DEMO=staging api \
//     node packages/api/dist/scripts/seed-demo.js --teacher you@school.org
//   docker compose exec -e SEED_DEMO=staging api node packages/api/dist/scripts/seed-demo.js --erase
// The teacher must have signed in once (PocketID) so their account exists.
import { pathToFileURL } from "node:url";
import { pool } from "../db.js";
import { seedDemo, eraseDemo } from "../demo/seed.js";

const USAGE = [
  "Usage (staging only — creates fake students, photos and votes):",
  "  SEED_DEMO=staging node packages/api/dist/scripts/seed-demo.js --teacher <email> [--small]",
  "  SEED_DEMO=staging node packages/api/dist/scripts/seed-demo.js --erase",
].join("\n");

const SMALL = { teams: 3, studentsPerTeam: 2, joinLinks: 2, photosPerTeam: 1, votesPerStudent: 2 };

export async function run(
  argv: string[],
  env: Record<string, string | undefined>,
  log: (line: string) => void,
): Promise<number> {
  if (env.SEED_DEMO !== "staging") {
    log(`Refusing to run: set SEED_DEMO=staging to confirm this is not production.\n${USAGE}`);
    return 1;
  }
  try {
    if (argv.includes("--erase")) {
      const erased = await eraseDemo();
      log(`Erased ${erased.length} demo trip(s) through the normal erasure path.`);
      return 0;
    }
    const at = argv.indexOf("--teacher");
    const teacherEmail = at >= 0 ? argv[at + 1] : undefined;
    if (!teacherEmail) {
      log(USAGE);
      return 1;
    }
    const { trips } = await seedDemo({ teacherEmail, ...(argv.includes("--small") ? SMALL : {}) });
    for (const t of trips) {
      log(`\n${t.name}  (${t.phase})`);
      log(`  admin:     ${t.adminUrl}`);
      if (t.phase === "reveal") log(`  ceremony:  ${t.ceremonyUrl}`);
      log(`  join links (one phone each${t.phase === "draft" ? "" : "; teams are locked, so these join as voters"}):`);
      for (const link of t.joinLinks) log(`    ${link}`);
    }
    log(`\nDone. Remove everything later with --erase.`);
    return 0;
  } catch (e) {
    log(`Seeding failed: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await run(process.argv.slice(2), process.env, (line) => console.log(line));
  await pool.end();
  process.exit(code);
}
