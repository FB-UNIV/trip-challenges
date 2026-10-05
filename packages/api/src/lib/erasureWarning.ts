// Pure helpers for pre-erasure warnings. Kept DB-free so the bracket logic is unit-testable.
// Escalating warnings fire at 7d / 1d / 1h before a Trip's effective erase deadline.

export const WARNING_BRACKETS = [
  { label: "1h", ms: 3_600_000 },
  { label: "1d", ms: 86_400_000 },
  { label: "7d", ms: 7 * 86_400_000 },
] as const;

export type WarningBracket = (typeof WARNING_BRACKETS)[number]["label"];

/**
 * The tightest warning window a deadline currently sits in.
 * Returns null when the deadline is more than 7d away (too early) or already
 * reached/passed (remaining <= 0 → the erasure runner handles it, not a warning).
 * Sending only the tightest bracket avoids blasting 7d+1d+1h at once for a
 * deadline that is, say, 90 minutes out.
 */
export function pickBracket(remainingMs: number): WarningBracket | null {
  if (remainingMs <= 0) return null;
  const b = WARNING_BRACKETS.find((x) => x.ms >= remainingMs);
  return b ? b.label : null;
}
