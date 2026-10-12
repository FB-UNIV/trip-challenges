-- The grace period starts when the teacher publishes the results (reveal -> grace), as
-- CONTEXT.md and the privacy page promise. It used to count from the PLANNED vote close
-- date, so a trip without one was only erased at its hard deadline.
ALTER TABLE trip ADD COLUMN grace_started_at timestamptz;

-- Trips already in grace: keep the old start when there was one (never in the future),
-- otherwise start now.
UPDATE trip
   SET grace_started_at = LEAST(COALESCE(voting_closes_at, now()), now())
 WHERE phase = 'grace';
