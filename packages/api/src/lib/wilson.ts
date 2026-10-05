// Wilson lower-bound of a binomial proportion (ADR-0002).
// Ranking score for a Nomination = wilsonLower(wins, comparisons).
// Fair under unequal/low comparison counts: few comparisons -> lower bound stays low.
export function wilsonLower(wins: number, comparisons: number, z = 1.96): number {
  if (comparisons === 0) return 0;
  const p = wins / comparisons;
  const z2 = z * z;
  const denom = 1 + z2 / comparisons;
  const centre = p + z2 / (2 * comparisons);
  const margin =
    z * Math.sqrt((p * (1 - p) + z2 / (4 * comparisons)) / comparisons);
  return (centre - margin) / denom;
}
