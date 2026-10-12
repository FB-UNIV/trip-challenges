-- #166: the reveal ceremony shows each podium's photo. result survives Erasure, so the link
-- must not: it points at the submission row, which Erasure deletes (ON DELETE SET NULL), and
-- eraseTrip() also clears it explicitly. Results computed before this migration have none.
ALTER TABLE result ADD COLUMN submission_id uuid REFERENCES submission(id) ON DELETE SET NULL;
