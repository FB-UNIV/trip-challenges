// Ordering for the vote list and the "next challenge" jump: what's left first.
import type { StudentChallenge } from "@trip/shared";

const RANK = { in_progress: 0, todo: 1, not_enough: 2, done: 3 } as const;
const rank = (c: StudentChallenge) => (c.vote ? RANK[c.vote.status] : 4);

/** Started before untouched, then waiting for photos, then finished; server order within each. */
export const byVotingOrder = (list: StudentChallenge[]) => [...list].sort((a, b) => rank(a) - rank(b));

/** Has a pair this student can still vote on. */
export const canVote = (c: StudentChallenge) => c.vote?.status === "todo" || c.vote?.status === "in_progress";
