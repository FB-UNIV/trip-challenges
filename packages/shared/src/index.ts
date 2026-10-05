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
