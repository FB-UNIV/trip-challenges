-- Trip Challenges schema. Mirrors docs/data-model.md.
-- 🔒 columns hold ciphertext (Vault transit, per-Trip key). Destroying the key
-- crypto-erases them (ADR-0001). Plain columns are non-PII and survive Erasure.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";

-- ---------- Global (span Trips) ----------
CREATE TABLE teacher (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oidc_subject  text UNIQUE NOT NULL,
  email         citext NOT NULL,
  display_name  text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- Trip ----------
CREATE TYPE trip_phase AS ENUM ('draft','challenge','voting','reveal','grace','erased');

CREATE TABLE trip (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  owner_teacher_id   uuid NOT NULL REFERENCES teacher(id),
  max_team_size      int NOT NULL DEFAULT 4 CHECK (max_team_size >= 1),
  points_table       jsonb NOT NULL DEFAULT '[{"placement":1,"points":5},{"placement":2,"points":3},{"placement":3,"points":1}]',
  phase              trip_phase NOT NULL DEFAULT 'draft',
  challenge_opens_at timestamptz,
  voting_opens_at    timestamptz,
  voting_closes_at   timestamptz,
  grace_days         int NOT NULL DEFAULT 7,
  trip_end_date      date NOT NULL,
  max_retention_days int NOT NULL DEFAULT 30,
  hard_erase_at      timestamptz NOT NULL,   -- trip_end_date + max_retention_days
  vault_key_name     text NOT NULL,          -- 'trip-<id>'; key itself lives in Vault
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trip_teacher (
  trip_id    uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES teacher(id),
  role       text NOT NULL CHECK (role IN ('owner','co')),
  PRIMARY KEY (trip_id, teacher_id)
);

CREATE TABLE trip_teacher_invite (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  email       citext NOT NULL,
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz
);

-- ---------- Student ----------
CREATE TABLE student (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id           uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  email_enc         bytea NOT NULL,          -- 🔒 Vault-encrypted email
  email_lookup      text NOT NULL,           -- Trip-scoped HMAC(email) for dedupe
  access_code_hash  text NOT NULL,           -- argon2id of single-use code
  access_code_state text NOT NULL DEFAULT 'unredeemed'
                    CHECK (access_code_state IN ('unredeemed','redeemed','reissued')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, email_lookup)
);

CREATE TABLE student_session (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES student(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- ---------- Team ----------
CREATE TABLE team (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id    uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  name_enc   bytea NOT NULL,                 -- 🔒 Vault-encrypted (may hold real names)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_member (
  team_id    uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES student(id) ON DELETE CASCADE,
  trip_id    uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, student_id),
  UNIQUE (trip_id, student_id)              -- exclusive: one Team per Student per Trip
);

-- ---------- Challenge ----------
CREATE TABLE challenge (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  title        text NOT NULL,
  instructions text NOT NULL DEFAULT '',
  multiplier   numeric NOT NULL DEFAULT 1 CHECK (multiplier > 0),
  qr_slug      text UNIQUE NOT NULL
);

-- ---------- Submission ----------
CREATE TABLE submission (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id                uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  challenge_id           uuid NOT NULL REFERENCES challenge(id) ON DELETE CASCADE,
  team_id                uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  uploaded_by_student_id uuid NOT NULL REFERENCES student(id),
  blob_key               text NOT NULL,      -- MinIO object (bytes are 🔒, envelope)
  content_type           text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  removed_by_teacher_id  uuid REFERENCES teacher(id)
);

-- ---------- Nomination ----------
CREATE TABLE nomination (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id                 uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  challenge_id            uuid NOT NULL REFERENCES challenge(id) ON DELETE CASCADE,
  team_id                 uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  submission_id           uuid NOT NULL REFERENCES submission(id) ON DELETE CASCADE,
  state                   text NOT NULL DEFAULT 'pending'
                          CHECK (state IN ('pending','approved','rejected')),
  moderated_by_teacher_id uuid REFERENCES teacher(id),
  moderated_at            timestamptz,
  auto_nominated          boolean NOT NULL DEFAULT false,
  active                  boolean NOT NULL DEFAULT true
);
-- one live nomination per (team, challenge)
CREATE UNIQUE INDEX nomination_one_active
  ON nomination (team_id, challenge_id) WHERE active;

-- ---------- Duel (pairwise vote) ----------
CREATE TABLE duel (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id               uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  challenge_id          uuid NOT NULL REFERENCES challenge(id) ON DELETE CASCADE,
  voter_student_id      uuid NOT NULL REFERENCES student(id) ON DELETE CASCADE,
  a_nomination_id       uuid NOT NULL REFERENCES nomination(id) ON DELETE CASCADE,
  b_nomination_id       uuid NOT NULL REFERENCES nomination(id) ON DELETE CASCADE,
  winner_nomination_id  uuid NOT NULL REFERENCES nomination(id) ON DELETE CASCADE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- no repeat pair per voter (store canonical least/greatest ordering)
  low_nomination_id     uuid NOT NULL,
  high_nomination_id    uuid NOT NULL,
  UNIQUE (voter_student_id, low_nomination_id, high_nomination_id)
);

CREATE TABLE nomination_stats (
  nomination_id uuid PRIMARY KEY REFERENCES nomination(id) ON DELETE CASCADE,
  trip_id       uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  wins          int NOT NULL DEFAULT 0,
  comparisons   int NOT NULL DEFAULT 0,
  wilson_score  double precision NOT NULL DEFAULT 0
);

-- ---------- Survivors of Erasure (non-PII) ----------
CREATE TABLE result (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id           uuid NOT NULL,          -- opaque; trip row may be gone
  challenge_title   text NOT NULL,
  placement         int NOT NULL,
  team_name_vetted  text NOT NULL,          -- teacher-reviewed, non-identifying
  points            numeric NOT NULL,
  is_grand_champion boolean NOT NULL DEFAULT false
);

CREATE TABLE audit_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id          uuid NOT NULL,           -- opaque
  teacher_id       uuid,                    -- actor (staff), nullable for system events
  action           text NOT NULL,           -- 'submission_removed','erasure_fired',...
  target_opaque_id uuid,                    -- never student PII
  at               timestamptz NOT NULL DEFAULT now()
);

-- Dedupe ledger for escalating pre-erasure warnings (7d/1d/1h). Keyed by the
-- deadline it was sent for, so a shifted deadline re-warns. No PII; survives Erasure.
CREATE TABLE erasure_warning (
  trip_id  uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  bracket  text NOT NULL CHECK (bracket IN ('7d','1d','1h')),
  erase_at timestamptz NOT NULL,
  sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, bracket, erase_at)
);

-- Background roster import queue. Enqueue stores the email 🔒 (Vault-encrypted) so
-- no plaintext PII is ever persisted; the scheduler worker later does the heavy
-- argon2 + SMTP and creates the Student. Deleted at Erasure with other PII.
CREATE TABLE roster_import_item (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  email_enc    bytea NOT NULL,          -- 🔒 Vault-encrypted email (pending PII)
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed')),
  attempts     int NOT NULL DEFAULT 0,
  last_error   text,                    -- error CODE/NAME only — never the address
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX ON roster_import_item (trip_id, status);
CREATE INDEX roster_pending ON roster_import_item (created_at) WHERE status = 'pending';

-- Helpful indexes for tenant-scoped access.
CREATE INDEX ON student (trip_id);
CREATE INDEX ON team (trip_id);
CREATE INDEX ON submission (trip_id, challenge_id);
CREATE INDEX ON nomination (trip_id, challenge_id) WHERE active;
CREATE INDEX ON duel (trip_id, challenge_id);
