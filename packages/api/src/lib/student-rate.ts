// Per-student request budget (staging load test, #63). The global limiter keys on the client
// IP, but a class voting together shares one school NAT address, so that limit has to fit a
// whole class. This second, smaller budget is per signed-in student: it stops one student's
// script without throttling classmates. It runs only after the session is verified (guard),
// so made-up cookies can't open fresh budgets; they still count against the IP.
// Fixed one-minute windows, in this process's memory, like @fastify/rate-limit's default store.
const WINDOW_MS = 60_000;
const windows = new Map<string, { start: number; count: number }>();

/** Count one request for `studentId`; true once it exceeds `max` in the current minute. */
export function overStudentBudget(studentId: string, max: number, now = Date.now()): boolean {
  let w = windows.get(studentId);
  if (!w || now - w.start >= WINDOW_MS) {
    if (windows.size > 10_000) {
      for (const [id, old] of windows) if (now - old.start >= WINDOW_MS) windows.delete(id);
    }
    w = { start: now, count: 0 };
    windows.set(studentId, w);
  }
  w.count++;
  return w.count > max;
}
