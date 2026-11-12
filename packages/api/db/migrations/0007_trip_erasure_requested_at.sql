-- A teacher's "Erase now" lowered hard_erase_at, and that was the only trace of it: a later
-- edit of the end date or retention recomputed hard_erase_at and took a failed erasure out of
-- the scheduler's due set (security audit 2026-10). The request is now its own column, which
-- keeps the trip due until erasure succeeds and blocks those edits meanwhile.
ALTER TABLE trip ADD COLUMN erasure_requested_at timestamptz;
