// API client. Cookies (student_session / teacher_session) ride along automatically.
import type { DuelPair, CastDuel } from "@trip/shared";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    ...init,
  });
  if (res.status === 401) throw new HttpError(401, "unauthorized");
  if (!res.ok) throw new HttpError(res.status, await res.text().catch(() => res.statusText));
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type Me = { studentId: string; tripId: string; tripName: string; phase: string; teamId: string | null };
export type TeacherMe = { id: string; email: string; display_name: string };
export type TeamView = { id: string; name: string; members: number };
export type TripSummary = { id: string; name: string; phase: string; role: string; trip_end_date: string };
export type ChallengeSummary = { id: string; title: string; instructions: string; multiplier: number; qr_slug: string };
export type NominationRow = { id: string; challenge_id: string; team_id: string; submission_id: string; state: string };
export type ResultRow = { id: string; challenge_title: string; placement: number; team_name_vetted: string; points: number; is_grand_champion: boolean };

export const api = {
  // ---- student ----
  redeemCode: (code: string) =>
    req<{ ok: true }>("/api/student/redeem", { method: "POST", body: JSON.stringify({ code }) }),
  requestReissue: (tripId: string, email: string) =>
    req<{ ok: true }>("/api/student/reissue", { method: "POST", body: JSON.stringify({ tripId, email }) }),
  me: () => req<Me>("/api/student/me"),
  resolveChallenge: (slug: string) =>
    req<{ id: string; title: string; instructions: string }>(`/api/challenges/by-slug/${slug}`),
  listTeams: () => req<{ teams: TeamView[] }>("/api/teams"),
  createTeam: (name: string) =>
    req<{ teamId: string }>("/api/teams", { method: "POST", body: JSON.stringify({ name }) }),
  joinTeam: (teamId: string) =>
    req<{ ok: true }>("/api/teams/join", { method: "POST", body: JSON.stringify({ teamId }) }),
  leaveTeam: () => req<{ ok: true }>("/api/teams/leave", { method: "POST", body: "{}" }),
  uploadSubmission: async (challengeId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/submissions?challengeId=${challengeId}`, {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    if (!res.ok) throw new HttpError(res.status, await res.text().catch(() => res.statusText));
    return (await res.json()) as { id: string };
  },
  myChallenges: () =>
    req<{ challenges: { id: string; title: string; instructions: string }[] }>("/api/challenges/for-student"),
  listSubmissions: (challengeId: string) =>
    req<{ submissions: { id: string; created_at: string; nominated: boolean }[] }>(
      `/api/submissions?challengeId=${challengeId}`,
    ),
  nominate: (challengeId: string, submissionId: string) =>
    req<{ ok: true }>("/api/nominations", {
      method: "POST",
      body: JSON.stringify({ challengeId, submissionId }),
    }),
  nextDuel: (challengeId: string) =>
    req<{ pair: DuelPair | null; reason?: "not_enough" | "exhausted" }>(
      `/api/duels/next?challengeId=${challengeId}`,
    ),
  castDuel: (body: CastDuel) =>
    req<{ ok: true }>("/api/duels/cast", { method: "POST", body: JSON.stringify(body) }),
  photoUrl: (submissionId: string) => `/api/submissions/${submissionId}/photo`,

  // ---- teacher ----
  teacherMe: () => req<TeacherMe>("/api/auth/teacher/me"),
  listTrips: () => req<{ trips: TripSummary[] }>("/api/trips"),
  getTrip: (id: string) => req<any>(`/api/trips/${id}`),
  createTrip: (cfg: Record<string, unknown>) =>
    req<{ id: string }>("/api/trips", { method: "POST", body: JSON.stringify(cfg) }),
  advance: (id: string, to: string) =>
    req<{ ok: true; phase: string }>(`/api/trips/${id}/advance`, {
      method: "POST",
      body: JSON.stringify({ to }),
    }),
  erase: (id: string) => req<{ ok: true }>(`/api/trips/${id}/erase`, { method: "POST", body: "{}" }),
  importRoster: (id: string, emails: string[]) =>
    req<{ queued: number; requested: number }>(`/api/trips/${id}/roster`, {
      method: "POST",
      body: JSON.stringify({ emails }),
    }),
  rosterStatus: (id: string) =>
    req<{ pending: number; done: number; failed: number; students: number }>(
      `/api/trips/${id}/roster/status`,
    ),
  updateTrip: (id: string, patch: Record<string, unknown>) =>
    req<{ ok: true }>(`/api/trips/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  createChallenge: (tripId: string, input: { title: string; instructions: string; multiplier: number }) =>
    req<{ id: string; qrSlug: string }>("/api/challenges", {
      method: "POST",
      body: JSON.stringify({ tripId, ...input }),
    }),
  updateChallenge: (id: string, patch: { title?: string; instructions?: string; multiplier?: number }) =>
    req<{ ok: true }>(`/api/challenges/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteChallenge: (id: string) =>
    req<{ ok: true }>(`/api/challenges/${id}`, { method: "DELETE" }),
  listChallenges: (tripId: string) =>
    req<{ challenges: ChallengeSummary[] }>(`/api/challenges?tripId=${tripId}`),
  qrUrl: (challengeId: string) => `/api/challenges/${challengeId}/qr.png`,
  listNominations: (tripId: string, state?: string) =>
    req<{ nominations: NominationRow[] }>(
      `/api/nominations/trip/${tripId}${state ? `?state=${state}` : ""}`,
    ),
  moderate: (nomId: string, decision: "approve" | "reject") =>
    req<{ ok: true }>(`/api/nominations/${nomId}/${decision}`, { method: "POST", body: "{}" }),
  removeSubmission: (id: string) =>
    req<{ ok: true }>(`/api/submissions/${id}/remove`, { method: "POST", body: "{}" }),
  results: (tripId: string) => req<{ results: ResultRow[] }>(`/api/trips/${tripId}/results`),
  setGrandChampion: (tripId: string, resultId: string) =>
    req<{ ok: true }>(`/api/trips/${tripId}/grand-champion`, {
      method: "POST",
      body: JSON.stringify({ resultId }),
    }),

  // ---- co-teacher invites ----
  listTripTeachers: (tripId: string) =>
    req<{ teachers: { id: string; email: string; display_name: string; role: string }[] }>(
      `/api/trips/${tripId}/teachers`,
    ),
  listInvites: (tripId: string) =>
    req<{ invites: { id: string; email: string; expires_at: string }[] }>(`/api/trips/${tripId}/invites`),
  invite: (tripId: string, email: string) =>
    req<{ invited: string }>(`/api/trips/${tripId}/invites`, { method: "POST", body: JSON.stringify({ email }) }),
  revokeInvite: (tripId: string, inviteId: string) =>
    req<{ ok: true }>(`/api/trips/${tripId}/invites/${inviteId}`, { method: "DELETE" }),
  previewInvite: (token: string) =>
    req<{ email: string; trip_name: string; expired: boolean }>(
      `/api/invites/preview?token=${encodeURIComponent(token)}`,
    ),
  acceptInvite: (token: string) =>
    req<{ ok: true; tripId: string }>("/api/invites/accept", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
};
