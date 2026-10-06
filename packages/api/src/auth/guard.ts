// One preHandler per route that answers "who may call this, on which Trip, in which phase"
// (#27). Every route declares a guard — test/guard.test.ts fails on any route without one —
// so a forgotten trip or phase check (#16, #17) can't slip in silently again.
//
// Order: role (401) → params/query/body (400) → trip resolution + membership (404, or 403
// for owner-only) → phase (409 or the route's own `closed` reply). A Trip that exists but
// isn't the caller's answers the same 404 as one that doesn't exist.
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import type { ZodTypeAny } from "zod";
import { pool } from "../db.js";
import { requireStudent, type StudentCtx } from "./student.js";
import { assertTripAccess, readTeacher, type TeacherCtx } from "./teacher.js";

export type Phase = "draft" | "challenge" | "voting" | "reveal" | "grace" | "erased";
/** `votingClosed`: a 'voting' Trip past its planned close time (#26) takes no more votes. */
export type TripContext = { id: string; phase: Phase; votingClosed: boolean };

declare module "fastify" {
  interface FastifyRequest {
    teacher?: TeacherCtx;
    student?: StudentCtx;
    trip?: TripContext;
  }
}

/** Where the id that leads to the Trip lives in the request, e.g. "params.id". */
type Ref = `params.${string}` | `query.${string}` | `body.${string}`;

export type TripSource = {
  /** Message of the 404 when the id doesn't lead to one of the caller's Trips. */
  notFound: string;
  resolve: (req: FastifyRequest) => Promise<string | undefined>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function read(req: FastifyRequest, ref: Ref): string | undefined {
  const [where, key] = ref.split(".", 2) as ["params" | "query" | "body", string];
  const v = (req[where] as Record<string, unknown> | undefined)?.[key];
  // Malformed ids are just "not found": never hand them to a uuid cast (500).
  return typeof v === "string" && UUID.test(v) ? v : undefined;
}

const via = (notFound: string, sql: string) => (ref: Ref): TripSource => ({
  notFound,
  resolve: async (req) => {
    const id = read(req, ref);
    if (!id) return undefined;
    const { rows } = await pool.query<{ trip_id: string }>(sql, [id]);
    return rows[0]?.trip_id;
  },
});

/** The entity a route is about, and so the Trip it belongs to. */
export const tripFrom = {
  trip: via("no such trip", `SELECT id AS trip_id FROM trip WHERE id = $1`),
  challenge: via("challenge", `SELECT trip_id FROM challenge WHERE id = $1`),
  nomination: via("nomination", `SELECT trip_id FROM nomination WHERE id = $1 AND active`),
  submission: via("submission", `SELECT trip_id FROM submission WHERE id = $1`),
};

export type GuardOpts = {
  role: "teacher" | "student" | "public";
  /** Validated (and replaced by the parsed value) before anything else; 400 on failure. */
  params?: ZodTypeAny;
  query?: ZodTypeAny;
  body?: ZodTypeAny;
  /** Teachers: which Trip the route acts on (must be one they teach). Students default to their own. */
  trip?: TripSource;
  /** Teachers: owner-only route; the 403 message for anyone else (co-teachers included). */
  owner?: string;
  /** Phases the route is open in. */
  phases?: Phase[];
  /** Reply outside `phases`; defaults to 409 wrong_phase. */
  closed?: { status: number; body: unknown };
};

const GUARD = Symbol("guard");

export function guard(opts: GuardOpts): preHandlerAsyncHookHandler {
  // A phase or owner check with no Trip to check it on would silently pass: refuse at boot.
  if ((opts.phases || opts.owner) && !opts.trip && opts.role !== "student") {
    throw new Error("guard: `phases`/`owner` need a `trip` source");
  }
  if (opts.owner && opts.role !== "teacher") throw new Error("guard: `owner` is a teacher check");
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    if (opts.role === "teacher") {
      const teacher = readTeacher(req, reply);
      if (!teacher) return reply.code(401).send({ error: "unauthorized", message: "teacher login required" });
      req.teacher = teacher;
    } else if (opts.role === "student") {
      const student = await requireStudent(req);
      if (!student) return reply.code(401).send({ error: "unauthorized", message: "no session" });
      req.student = student;
    }

    for (const where of ["params", "query", "body"] as const) {
      const schema = opts[where];
      if (!schema) continue;
      const parsed = schema.safeParse(req[where] ?? {});
      if (!parsed.success) {
        const message = where === "body"
          ? parsed.error.message
          : [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
        return reply.code(400).send({ error: "bad_request", message });
      }
      req[where] = parsed.data;
    }

    if (opts.role === "public") return;

    let tripId: string | undefined;
    if (opts.trip) {
      tripId = await opts.trip.resolve(req);
      if (tripId && opts.owner && !(await isOwner(req.teacher!.teacherId, tripId))) {
        return reply.code(403).send({ error: "forbidden", message: opts.owner });
      }
      const mine = tripId && (opts.owner || (req.student
        ? req.student.tripId === tripId
        : await assertTripAccess(req.teacher!.teacherId, tripId)));
      if (!mine) return reply.code(404).send({ error: "not_found", message: opts.trip.notFound });
    } else if (req.student) {
      tripId = req.student.tripId;
    }
    if (!tripId) return;

    const trip = await loadTrip(tripId);
    req.trip = trip;
    if (opts.phases && !opts.phases.includes(trip.phase)) {
      const closed = opts.closed ?? {
        status: 409,
        body: { error: "wrong_phase", message: `not available in phase '${trip.phase}'` },
      };
      return reply.code(closed.status).send(closed.body);
    }
  };
  return Object.assign(handler, { [GUARD]: true });
}

export const isGuard = (fn: unknown): boolean => typeof fn === "function" && GUARD in fn;

async function isOwner(teacherId: string, tripId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM trip_teacher WHERE trip_id = $1 AND teacher_id = $2 AND role = 'owner'`,
    [tripId, teacherId],
  );
  return (rowCount ?? 0) > 0;
}

async function loadTrip(id: string): Promise<TripContext> {
  const { rows } = await pool.query<{ phase: Phase; voting_closed: boolean }>(
    `SELECT phase, (phase = 'voting' AND voting_closes_at IS NOT NULL AND voting_closes_at <= now()) AS voting_closed
       FROM trip WHERE id = $1`,
    [id],
  );
  const row = rows[0]!;
  return { id, phase: row.phase, votingClosed: row.voting_closed };
}

function resolved<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`route reads the ${what} but its guard doesn't resolve one`);
  return value;
}

/** What the route's guard resolved. Throws (500) if the guard doesn't provide it. */
export const tripOf = (req: FastifyRequest): TripContext => resolved(req.trip, "trip");
export const teacherOf = (req: FastifyRequest): TeacherCtx => resolved(req.teacher, "teacher");
export const studentOf = (req: FastifyRequest): StudentCtx => resolved(req.student, "student");
