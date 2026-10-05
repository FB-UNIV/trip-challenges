# Pairwise (Tinder-style) voting ranked by Wilson lower-bound win-rate

Winners are elected by showing each voter two Nominations from the same Challenge and having them pick the better (a Duel), repeated over rounds — not by a single one-vote-per-voter tally. Each Nomination accrues a win/loss record; its score is the **Wilson lower-bound on its win-rate** (wins / comparisons), so Nominations with unequal or low numbers of comparisons are ranked fairly rather than by raw popularity or exposure order.

## Considered Options

- **One vote per voter, winner = most votes** — rejected: the requested UX is swipe/duel-based, and raw counts are biased by how many times each Nomination happens to be shown.
- **ELO / Bradley-Terry rating** — a natural fit for pairwise duels, but sensitive to comparison ordering and initial-rating choices, and harder to explain to teachers/students than a win-rate with a confidence bound.
- **Raw like-rate (Wilson on likes/views)** — the binary-swipe variant; superseded once the mechanic became pairwise, so "views/likes" is reframed as "comparisons/wins".

## Consequences

- Pairing is **least-compared-first + random eligible opponent**, excluding the voter's own Team and never repeating a pair to the same voter; voters Duel unlimited times per Challenge, coverage-guided. This evens out comparison counts so Wilson intervals tighten fastest.
- Fairness depends on accumulating enough Duels per Nomination; sparse voting yields wide confidence intervals and low scores across the board.
