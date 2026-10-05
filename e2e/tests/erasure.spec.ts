// Erasure against the real stack: not just "the API says so", but Postgres rows, MinIO
// objects and the Vault key itself (ADR-0001 crypto-erasure).
import { test, expect } from "@playwright/test";
import { signInTeacher, closeAll } from "../support/actors.js";
import { TripAdminPage } from "../pages/teacher.js";
import { seedTrip } from "./seed.js";
import {
  rowsFor, tripPhase, blobCount, vaultKeyExists, vaultCanDecrypt, anyTeamNameCiphertext,
} from "../support/infra.js";

const PII_TABLES = ["student", "team", "team_member", "submission", "nomination", "challenge", "roster_import_item"];

test("erasing a trip destroys its rows, photos and Vault key, and leaves other trips intact", async ({ browser }) => {
  const teacher = await signInTeacher(browser);
  const doomed = await seedTrip(browser, teacher, { teams: ["Foxes", "Owls"], phase: "challenge", approve: false });
  const bystander = await seedTrip(browser, teacher, { teams: ["Bears"], phase: "challenge", approve: false });
  const ciphertext = await anyTeamNameCiphertext(doomed.tripId);

  await test.step("before: data is present and decryptable", async () => {
    expect(await rowsFor("student", doomed.tripId)).toBe(2);
    expect(await blobCount(doomed.tripId)).toBe(2);
    expect(await vaultKeyExists(doomed.tripId)).toBe(true);
    expect(await vaultCanDecrypt(doomed.tripId, ciphertext!)).toBe(true);
  });

  await test.step("the teacher erases the trip", async () => {
    const admin = new TripAdminPage(teacher.page);
    await admin.goto(doomed.tripId);
    await admin.eraseNow();
  });

  await test.step("after: nothing student-scoped remains, and old ciphertext is unreadable", async () => {
    expect(await tripPhase(doomed.tripId)).toBe("erased");
    for (const table of PII_TABLES) expect(await rowsFor(table, doomed.tripId), table).toBe(0);
    expect(await blobCount(doomed.tripId)).toBe(0);
    expect(await vaultKeyExists(doomed.tripId)).toBe(false);
    // A backup holding this ciphertext is now useless.
    expect(await vaultCanDecrypt(doomed.tripId, ciphertext!)).toBe(false);

    for (const c of doomed.contenders) expect((await c.api.r.get("/api/student/me")).status()).toBe(401);
  });

  await test.step("the other trip is untouched", async () => {
    expect(await rowsFor("student", bystander.tripId)).toBe(1);
    expect(await blobCount(bystander.tripId)).toBe(1);
    expect(await vaultKeyExists(bystander.tripId)).toBe(true);
  });

  await closeAll(teacher, ...doomed.contenders, ...bystander.contenders);
});
