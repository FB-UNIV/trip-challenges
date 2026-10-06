// RED stub for #27 — interface only; behaviour lands in the GREEN commit.
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import type { ZodTypeAny } from "zod";
import type { StudentCtx } from "./student.js";
import type { TeacherCtx } from "./teacher.js";

export type Phase = "draft" | "challenge" | "voting" | "reveal" | "grace" | "erased";
export type TripContext = { id: string; phase: Phase; votingClosed: boolean };
type Ref = `params.${string}` | `query.${string}` | `body.${string}`;
export type TripSource = { notFound: string; resolve: (req: FastifyRequest) => Promise<string | undefined> };

export type GuardOpts = {
  role: "teacher" | "student" | "public";
  params?: ZodTypeAny;
  query?: ZodTypeAny;
  body?: ZodTypeAny;
  trip?: TripSource;
  owner?: string;
  phases?: Phase[];
  closed?: { status: number; body: unknown };
};

export const tripFrom = {
  trip: (_ref: Ref): TripSource => ({ notFound: "", resolve: async () => undefined }),
  challenge: (_ref: Ref): TripSource => ({ notFound: "", resolve: async () => undefined }),
  nomination: (_ref: Ref): TripSource => ({ notFound: "", resolve: async () => undefined }),
  submission: (_ref: Ref): TripSource => ({ notFound: "", resolve: async () => undefined }),
};

export function guard(_opts: GuardOpts): preHandlerAsyncHookHandler {
  return async (_req: FastifyRequest, _reply: FastifyReply) => {};
}

export const isGuard = (_fn: unknown): boolean => false;
export const tripOf = (req: FastifyRequest) => (req as any).trip as TripContext;
export const teacherOf = (req: FastifyRequest) => (req as any).teacher as TeacherCtx;
export const studentOf = (req: FastifyRequest) => (req as any).student as StudentCtx;
