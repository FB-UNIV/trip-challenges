-- Scaleway TEM reports a failed mail by its Message-ID's local part only (the bare uuid, no
-- brackets or domain), so the bounce poller matches on that part. Index what it looks up.
DROP INDEX IF EXISTS student_mail_message_id_idx;
CREATE INDEX student_mail_message_id_local_idx
  ON student (split_part(btrim(mail_message_id, '<>'), '@', 1))
  WHERE mail_message_id IS NOT NULL;
