// Shared domain contract. Terms match CONTEXT.md; shapes match docs/data-model.md.
// zod schemas here are the single source of truth for both runtime validation (api)
// and static types (web + api).
import { z } from "zod";

// ---- Enums (ubiquitous language) ----
export const TripPhase = z.enum([
  "draft",
  "challenge",
  "voting",
  "reveal",
  "grace",
  "erased",
]);
export type TripPhase = z.infer<typeof TripPhase>;

export const TeacherRole = z.enum(["owner", "co"]);
export type TeacherRole = z.infer<typeof TeacherRole>;

export const NominationState = z.enum(["pending", "approved", "rejected"]);
export type NominationState = z.infer<typeof NominationState>;

export const AccessCodeState = z.enum(["unredeemed", "redeemed", "reissued"]);
export type AccessCodeState = z.infer<typeof AccessCodeState>;

// ---- Value objects ----
export const Uuid = z.string().uuid();
export const Email = z.string().email().max(320);

// A points-table row: placement -> points (Grand Champion scoring).
export const PointsRow = z.object({
  placement: z.number().int().positive(),
  points: z.number().nonnegative(),
});
export type PointsRow = z.infer<typeof PointsRow>;

// ---- Trip ----
export const TripConfig = z.object({
  name: z.string().min(1).max(200),
  maxTeamSize: z.number().int().min(1).max(20).default(4),
  pointsTable: z.array(PointsRow).default([
    { placement: 1, points: 5 },
    { placement: 2, points: 3 },
    { placement: 3, points: 1 },
  ]),
  challengeOpensAt: z.coerce.date().optional(),
  votingOpensAt: z.coerce.date().optional(),
  votingClosesAt: z.coerce.date().optional(),
  graceDays: z.number().int().min(0).max(365).default(7),
  tripEndDate: z.coerce.date(),
  maxRetentionDays: z.number().int().min(1).max(365).default(30),
});
export type TripConfig = z.infer<typeof TripConfig>;

// Post-creation config edits, phase-gated by the API (see
// docs/data-model.md#editability-config-edits-via-patch). Every field optional; the server
// rejects any field not editable in the current phase.
export const TripConfigPatch = z
  .object({
    name: z.string().min(1).max(200),
    maxTeamSize: z.number().int().min(1).max(20),
    pointsTable: z.array(PointsRow),
    challengeOpensAt: z.coerce.date().nullable(),
    votingOpensAt: z.coerce.date().nullable(),
    votingClosesAt: z.coerce.date().nullable(),
    graceDays: z.number().int().min(0).max(365),
    tripEndDate: z.coerce.date(),
    maxRetentionDays: z.number().int().min(1).max(365),
  })
  .partial();
export type TripConfigPatch = z.infer<typeof TripConfigPatch>;

// ---- Challenge ----
export const ChallengeInput = z.object({
  title: z.string().min(1).max(200),
  instructions: z.string().max(4000).default(""),
  multiplier: z.number().positive().max(100).default(1),
});
export type ChallengeInput = z.infer<typeof ChallengeInput>;

// Edit a challenge's content (title/instructions/multiplier); all optional.
export const ChallengePatch = ChallengeInput.partial();
export type ChallengePatch = z.infer<typeof ChallengePatch>;

export const ChallengeView = ChallengeInput.extend({
  id: Uuid,
  qrSlug: z.string(),
});
export type ChallengeView = z.infer<typeof ChallengeView>;

// ---- Roster / Access Code ----
export const RosterImport = z.object({
  emails: z.array(Email).min(1).max(2000),
});
export type RosterImport = z.infer<typeof RosterImport>;

export const RedeemAccessCode = z.object({
  code: z.string().min(10).max(200),
});
export type RedeemAccessCode = z.infer<typeof RedeemAccessCode>;

// Lost/changed device: request a fresh Access Code by email. Trip-scoped because the
// email_lookup MAC key is per-Trip (CONTEXT: Access Code, Trip).
export const ReissueAccessCode = z.object({
  tripId: Uuid,
  email: Email,
});
export type ReissueAccessCode = z.infer<typeof ReissueAccessCode>;

// ---- Co-teacher invites ----
export const InviteCoTeacher = z.object({
  email: Email,
});
export type InviteCoTeacher = z.infer<typeof InviteCoTeacher>;

export const AcceptInvite = z.object({
  token: z.string().min(10).max(200),
});
export type AcceptInvite = z.infer<typeof AcceptInvite>;

// ---- Team ----
export const CreateTeam = z.object({
  name: z.string().min(1).max(80),
});
export const JoinTeam = z.object({ teamId: Uuid });

// ---- Submission / Nomination ----
export const NominateInput = z.object({
  challengeId: Uuid,
  submissionId: Uuid,
});
export type NominateInput = z.infer<typeof NominateInput>;

// ---- Duel (pairwise vote) ----
// Server hands the client a pair; client returns which side won.
export const DuelPair = z.object({
  challengeId: Uuid,
  aNominationId: Uuid,
  bNominationId: Uuid,
  // submission ids for rendering the two photos
  aSubmissionId: Uuid,
  bSubmissionId: Uuid,
  // signed token binding this pair to this voter, to prevent forged/duplicate duels
  pairToken: z.string(),
});
export type DuelPair = z.infer<typeof DuelPair>;

export const CastDuel = z.object({
  pairToken: z.string(),
  winnerNominationId: Uuid,
});
export type CastDuel = z.infer<typeof CastDuel>;

// ---- Student challenge list (checklist + vote list) ----
// Progress is only ever the calling student's own: their Team's photos, their own Duels.
// `total` = pairs this voter can be shown: n·(n−1)/2 over approved Nominations of other Teams.
export const VoteProgress = z.object({
  voted: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  status: z.enum(["todo", "in_progress", "done", "not_enough"]),
});
export type VoteProgress = z.infer<typeof VoteProgress>;

export const StudentChallenge = z.object({
  id: Uuid,
  title: z.string(),
  instructions: z.string(),
  qrSlug: z.string(),
  photos: z.number().int().nonnegative(), // my Team's live (not removed) Submissions
  nominated: z.boolean(), // my Team has an active Nomination
  vote: VoteProgress.nullable(), // null unless the Voting Period is open
});
export type StudentChallenge = z.infer<typeof StudentChallenge>;

export const StudentChallengeList = z.object({ challenges: z.array(StudentChallenge) });
export type StudentChallengeList = z.infer<typeof StudentChallengeList>;

// ---- Teacher: trip progress (counts only, no student data) ----
export const ChallengeProgress = z.object({
  id: Uuid,
  title: z.string(),
  teamsWithPhotos: z.number().int().nonnegative(), // Teams with ≥1 live (not removed) Submission
  pending: z.number().int().nonnegative(), // active Nominations by moderation state
  approved: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
});
export type ChallengeProgress = z.infer<typeof ChallengeProgress>;

export const TripProgress = z.object({
  students: z.number().int().nonnegative(),
  teams: z.number().int().nonnegative(), // Teams with at least one member
  studentsWithoutTeam: z.number().int().nonnegative(),
  challenges: z.array(ChallengeProgress),
  teamsUnreviewed: z.number().int().nonnegative(), // Teams with members whose name no Teacher reviewed (ADR 0007)
  voters: z.number().int().nonnegative(), // distinct Students who judged at least one Duel — never who
  eraseAt: z.string(), // when Erasure will fire as things stand (ISO instant)
  graceEndsAt: z.string().nullable(), // voting close + grace days; null without a close date
});
export type TripProgress = z.infer<typeof TripProgress>;

// ---- Teacher: a Trip's students (emails decrypted for its teachers, ADR 0006) ----
// kind "student": a Student row (id = student id). kind "import": a Roster address that
// never became a Student (id = roster item id) — still sending, or failed.
export const RosterStatus = z.enum(["joined", "invited", "undelivered", "sending"]);
export const RosterEntry = z.object({
  kind: z.enum(["student", "import"]),
  id: Uuid,
  email: z.string(),
  status: RosterStatus, // CONTEXT: Joined; "sending" = still in the mail queue
  newCodeRequested: z.boolean(), // joined, and a fresh code is waiting to be used (lost device)
  teamId: Uuid.nullable(),
  lastError: z.string().nullable(), // mail error code only, never the address
});
export type RosterEntry = z.infer<typeof RosterEntry>;
export const RosterList = z.object({
  students: z.array(RosterEntry),
  counts: z.object({
    all: z.number().int().nonnegative(),
    notJoined: z.number().int().nonnegative(),
    undelivered: z.number().int().nonnegative(),
    noTeam: z.number().int().nonnegative(),
    sending: z.number().int().nonnegative(),
  }),
});
export type RosterList = z.infer<typeof RosterList>;
const NormalEmail = z.string().trim().toLowerCase().pipe(Email);
export const FixAddress = z.object({ email: NormalEmail });
export const RetryRosterItem = z.object({ email: NormalEmail.optional() });

// ---- Teacher: a Trip's Teams (names decrypted for its teachers) ----
export const TripTeam = z.object({
  id: Uuid,
  name: z.string(),
  label: z.string(), // neutral "Team N" (creation order): what an unreviewed name becomes at Erasure
  nameReviewed: z.boolean(),
  members: z.array(Uuid), // Student ids; emails come from the roster
  photos: z.number().int().nonnegative(), // live (not removed) Submissions
  challengesEntered: z.number().int().nonnegative(),
  nominations: z.object({
    pending: z.number().int().nonnegative(),
    approved: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  }),
});
export type TripTeam = z.infer<typeof TripTeam>;
export const TripTeamList = z.object({ teams: z.array(TripTeam), maxTeamSize: z.number().int().positive() });
export type TripTeamList = z.infer<typeof TripTeamList>;
export const RenameTeam = z.object({ name: z.string().trim().min(1).max(80) });

// ---- Results (survive Erasure; non-PII) ----
export const ResultRow = z.object({
  challengeTitle: z.string(),
  placement: z.number().int().positive(),
  teamNameVetted: z.string(),
  points: z.number(),
  isGrandChampion: z.boolean(),
});
export type ResultRow = z.infer<typeof ResultRow>;

// ---- API error envelope ----
export const ApiError = z.object({
  error: z.string(),
  message: z.string(),
});
export type ApiError = z.infer<typeof ApiError>;
