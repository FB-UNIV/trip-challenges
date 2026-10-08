-- #92: team names are free text and may identify students (ADR 0004, ADR 0007). Only a name
-- a teacher reviewed may survive Erasure; any other is replaced by a neutral "Team N" label.

-- A teacher marks a team's name reviewed (renaming counts as reviewing).
ALTER TABLE team ADD COLUMN name_reviewed boolean NOT NULL DEFAULT false;

-- Recorded at reveal, so Erasure can substitute without the (about to be destroyed) key.
ALTER TABLE result ADD COLUMN team_label text;                                  -- "Team N", trip-wide creation order
ALTER TABLE result ADD COLUMN team_name_reviewed boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN result.team_name_vetted IS
  'Team name as chosen until Erasure; afterwards the reviewed name or, if never reviewed, team_label.';

-- Trips already erased kept their names unreviewed: neutralise them now. One label per name
-- within a trip, so a team keeps the same label across its rows. Live trips are left for
-- their own Erasure to decide.
UPDATE result r
   SET team_name_vetted = x.label, team_label = x.label
  FROM (SELECT id, 'Team ' || dense_rank() OVER (PARTITION BY trip_id ORDER BY team_name_vetted) AS label
          FROM result) x
 WHERE r.id = x.id
   AND NOT EXISTS (SELECT 1 FROM trip t WHERE t.id = r.trip_id AND t.phase <> 'erased');
