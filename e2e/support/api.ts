// Thin typed wrappers over the real HTTP API, used to seed state quickly so each spec
// spends its browser time on the flow it is actually testing. Calls go through the
// Vite proxy with the context's cookies (teacher_session / student_session).
import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";

async function ok<T>(res: APIResponse): Promise<T> {
  expect(res.ok(), `${res.url()} -> ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

export type Nomination = { id: string; challenge_id: string; team_id: string; submission_id: string; state: string };
export type Result = { id: string; challenge_title: string; placement: number; team_name_vetted: string; points: string | number; is_grand_champion: boolean };

export class TeacherApi {
  constructor(readonly r: APIRequestContext) {}

  async createTrip(name: string, cfg: Record<string, unknown> = {}): Promise<string> {
    const body = { name, tripEndDate: "2030-06-01", ...cfg };
    return (await ok<{ id: string }>(await this.r.post("/api/trips", { data: body }))).id;
  }
  async trip(id: string): Promise<{ phase: string; name: string }> {
    return ok(await this.r.get(`/api/trips/${id}`));
  }
  async addChallenge(tripId: string, title: string, multiplier = 1): Promise<{ id: string; qrSlug: string }> {
    return ok(await this.r.post("/api/challenges", { data: { tripId, title, instructions: `Do: ${title}`, multiplier } }));
  }
  async importRoster(tripId: string, emails: string[]): Promise<void> {
    await ok(await this.r.post(`/api/trips/${tripId}/roster`, { data: { emails } }));
  }
  async advance(tripId: string, to: string): Promise<void> {
    await ok(await this.r.post(`/api/trips/${tripId}/advance`, { data: { to } }));
  }
  async nominations(tripId: string, state?: string): Promise<Nomination[]> {
    const qs = state ? `?state=${state}` : "";
    return (await ok<{ nominations: Nomination[] }>(await this.r.get(`/api/nominations/trip/${tripId}${qs}`))).nominations;
  }
  async moderate(nominationId: string, decision: "approve" | "reject"): Promise<void> {
    await ok(await this.r.post(`/api/nominations/${nominationId}/${decision}`, { data: {} }));
  }
  async results(tripId: string): Promise<Result[]> {
    return (await ok<{ results: Result[] }>(await this.r.get(`/api/trips/${tripId}/results`))).results;
  }
}

export class StudentApi {
  constructor(readonly r: APIRequestContext) {}

  async me(): Promise<{ studentId: string; tripId: string; teamId: string | null; phase: string }> {
    return ok(await this.r.get("/api/student/me"));
  }
  async createTeam(name: string): Promise<string> {
    return (await ok<{ teamId: string }>(await this.r.post("/api/teams", { data: { name } }))).teamId;
  }
  async joinTeam(teamId: string): Promise<void> {
    await ok(await this.r.post("/api/teams/join", { data: { teamId } }));
  }
  async upload(challengeId: string, png: Buffer): Promise<string> {
    const res = await this.r.post(`/api/submissions?challengeId=${challengeId}`, {
      multipart: { file: { name: "photo.png", mimeType: "image/png", buffer: png } },
    });
    return (await ok<{ id: string }>(res)).id;
  }
  async nominate(challengeId: string, submissionId: string): Promise<void> {
    await ok(await this.r.post("/api/nominations", { data: { challengeId, submissionId } }));
  }
  /** Raw so specs can assert on status codes. */
  nextDuel(challengeId: string) {
    return this.r.get(`/api/duels/next?challengeId=${challengeId}`);
  }
  cast(pairToken: string, winnerNominationId: string) {
    return this.r.post("/api/duels/cast", { data: { pairToken, winnerNominationId } });
  }
}
