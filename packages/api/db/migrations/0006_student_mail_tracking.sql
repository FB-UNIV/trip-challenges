-- #104: a relay accepts mail for a mailbox that doesn't exist and fails it later, so a student
-- stayed Invited forever. mail_message_id is the opaque Message-ID (<uuid@sender domain>) of the
-- student's latest access-code mail: the bounce poller finds the student by it, never by address.
-- mail_error is the relay's verdict as a code (MAILBOX_NOT_FOUND…), never its text, which can
-- echo the address. Both live on the student row, so Erasure removes them with it.
ALTER TABLE student ADD COLUMN mail_message_id text;
ALTER TABLE student ADD COLUMN mail_error text;
CREATE INDEX student_mail_message_id_idx ON student (mail_message_id) WHERE mail_message_id IS NOT NULL;
