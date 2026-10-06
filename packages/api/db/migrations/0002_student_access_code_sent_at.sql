-- #18: track whether a student's current access code was actually emailed, so the roster
-- worker can tell "already sent" (skip) from "inserted but the mail failed" (re-send).
ALTER TABLE student ADD COLUMN access_code_sent_at timestamptz;

-- Students that exist today were created by the old worker, which only marked an item
-- done after attempting the mail; treat them as sent rather than mailing everyone again.
UPDATE student SET access_code_sent_at = created_at;
