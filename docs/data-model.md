# Data Model

Schema design for Trip Challenges. Derived from `CONTEXT.md` and the ADRs. Postgres for relational data, MinIO for photo blobs, Vault (transit) for per-Trip keys. Not migrations — the contract the code encodes.

Notation: 🔒 = encrypted at rest under the **per-Trip key** (Vault transit key `trip-<tripId>`); destroying that key crypto-erases every 🔒 value (ADR-0001). Plain columns are non-PII and survive Erasure.

---

## Global (not Trip-scoped, survive across Trips)

### teacher
Staff identity, sourced from PocketID OIDC. Spans Trips; not under any Trip key.

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| oidc_subject | text unique | PocketID `sub`; the real identity anchor |
| email | citext | staff email (not a minor) |
| display_name | text | |
| created_at | timestamptz | |

---

## Trip-scoped

Every table below carries `trip_id uuid` (FK -> trip) and is filtered by it on every query (tenant isolation, ADR: many concurrent Trips).

### trip
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text | |
| owner_teacher_id | uuid fk->teacher | creator/owner |
| max_team_size | int | default 4 |
| points_table | jsonb | `[{placement:1,points:5},{2,3},{3,1}]`, editable |
| phase | text enum | `draft \| challenge \| voting \| reveal \| grace \| erased` |
| challenge_opens_at | timestamptz | planned |
| voting_opens_at | timestamptz | planned |
| voting_closes_at | timestamptz | planned |
| grace_days | int | default 7 (post-voting auto-wipe) |
| trip_end_date | date | for hard cap |
| max_retention_days | int | default 30 |
| hard_erase_at | timestamptz | = trip_end_date + max_retention_days; force-wipe regardless of phase |
| vault_key_name | text | `trip-<id>`; reference only, key lives in Vault |
| created_at | timestamptz | |

`teams_locked` derives from `phase >= challenge` (membership freezes at challenge start).

### trip_teacher — co-teacher membership
| column | type | notes |
|---|---|---|
| trip_id | uuid fk | |
| teacher_id | uuid fk | |
| role | text enum | `owner \| co` |
| pk | (trip_id, teacher_id) | |

### trip_teacher_invite — pending co-teacher invites
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| trip_id | uuid fk | |
| email | citext | invited colleague (staff) |
| token_hash | text | single-use, expiring |
| accepted_at | timestamptz null | bound to teacher on PocketID login |

### student — a minor participant, unique per Trip
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| trip_id | uuid fk | |
| email 🔒 | bytea | Vault-encrypted; the only student PII field |
| email_lookup | text | HMAC(email) under a Trip-scoped MAC key, for dedupe/lookup without decrypting |
| access_code_hash | text | argon2id of the 128-bit single-use code; never store plaintext |
| access_code_state | text enum | `unredeemed \| redeemed \| reissued` |
| created_at | timestamptz | |

Same email in two Trips = two rows in two Trips, different `email_lookup` (different MAC key). No cross-Trip join possible.

### student_session — device-bound session
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| student_id | uuid fk | |
| token_hash | text | `sha256:<hex>` of the 256-bit device token (#64); legacy argon2 hashes are upgraded on first use |
| created_at | timestamptz | |
| revoked_at | timestamptz null | set when a fresh code is re-issued (invalidates prior session) |

Single-use code -> one active session; re-issue revokes the old (Access Code term).

### team
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| trip_id | uuid fk | |
| name 🔒 | bytea | Vault-encrypted (may contain real names -> treat as PII). Copied into `result` at reveal; it survives Erasure only if reviewed (see `result`). |
| name_reviewed | bool | a Teacher reviewed the name (renaming counts). Only reviewed names survive Erasure (ADR-0007). |
| created_at | timestamptz | also sets the neutral label order ("Team N") |

### team_member — exclusive membership (one Team per Student per Trip)
| column | type | notes |
|---|---|---|
| team_id | uuid fk | |
| student_id | uuid fk | |
| unique(student_id) within trip | | enforces exclusivity |
| bounded 1..trip.max_team_size | | app-enforced |

### challenge — teacher-authored, not PII
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| trip_id | uuid fk | |
| title | text | |
| instructions | text | |
| multiplier | numeric | default 1 (boss challenge = 2, etc.); scales Grand Champion points |
| qr_slug | text unique | encoded in the printed QR URL; static |

### submission — a photo
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| trip_id | uuid fk | |
| challenge_id | uuid fk | |
| team_id | uuid fk | attribution unit |
| uploaded_by_student_id | uuid fk | any team member may upload |
| blob_key | text | MinIO object key; **object bytes 🔒** (envelope: per-object data key from Vault, wrapped under the Trip key) |
| content_type | text | validated (image/*), EXIF+GPS stripped on ingest |
| created_at | timestamptz | |
| removed_by_teacher_id | uuid null | standing teacher oversight (remove any submission) |

Non-nominated submissions persist (team-only) until Erasure.

### nomination — the votable pick, one active per (team, challenge)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| trip_id | uuid fk | |
| challenge_id | uuid fk | |
| team_id | uuid fk | |
| submission_id | uuid fk | the chosen photo |
| state | text enum | `pending \| approved \| rejected` (moderation) |
| moderated_by_teacher_id | uuid null | |
| moderated_at | timestamptz null | |
| auto_nominated | bool | true if latest was auto-picked at voting open |
| unique(team_id, challenge_id) where active | | one live nomination |

### duel — one pairwise comparison (atomic vote)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| trip_id | uuid fk | |
| challenge_id | uuid fk | |
| voter_student_id | uuid fk | |
| a_nomination_id | uuid fk | |
| b_nomination_id | uuid fk | |
| winner_nomination_id | uuid fk | chosen side |
| created_at | timestamptz | |
| unique(voter, unordered{a,b}) | | no repeat pair per voter |

Neither side may belong to the voter's own Team (no self-vote). Pairing: least-compared-first + random eligible opponent.

### nomination_stats — denormalized for fast Wilson ranking
| column | type | notes |
|---|---|---|
| nomination_id | uuid pk fk | |
| wins | int | |
| comparisons | int | |
| wilson_score | double | lower-bound(win-rate); recomputed on duel write |

Ranking per Challenge = order by `wilson_score` desc (ADR-0002).

---

## Survivors of Erasure (non-PII, not under Trip key)

### result — the keepsake
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| trip_id | uuid | kept as opaque id |
| challenge_title | text | copied at reveal |
| placement | int | 1..N |
| team_name_vetted | text | copied from `team.name` at reveal; at Erasure, replaced by `team_label` unless `team_name_reviewed` |
| points | numeric | placement points × challenge multiplier |
| is_grand_champion | bool | |
| team_label | text | neutral "Team N" (trip-wide team creation order), recorded at reveal |
| team_name_reviewed | bool | copy of `team.name_reviewed` at reveal |

Populated during the teacher-paced ceremony; contains **no image, no student identity**.

### audit_log — PII-free by design
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| trip_id | uuid | opaque |
| teacher_id | uuid | actor (staff) |
| action | text | e.g. `submission_removed`, `nomination_rejected`, `erasure_fired`, `voting_closed` |
| target_opaque_id | uuid null | references an id, never student PII |
| at | timestamptz | |

Survives Erasure precisely because it never holds student PII (CONTEXT: Erasure › Survives).

---

## Encryption boundary (per-Trip key)

🔒 under Vault transit key `trip-<tripId>`:
- `student.email`
- `team.name`
- `submission` photo **bytes** in MinIO (envelope: Vault-issued data key wrapped under the Trip key)

Also Trip-scoped but not raw-PII: `access_code_hash` (a hash), `email_lookup` (a Trip-scoped HMAC) — safe to store as-is; they carry no recoverable PII once the Trip key/MAC key is destroyed.

**Not** encrypted (survive): teacher identity, challenge content, `result`, `audit_log`, trip config.

## Erasure procedure (maps to ADR-0001)
1. Delete MinIO objects for the Trip (best-effort hard delete of live blobs).
2. Replace every unreviewed team name in `result` with its neutral label (ADR-0007), then delete all Trip-scoped rows (student, team, submission, nomination, duel, stats, sessions, invites) — cascade by `trip_id`.
3. Scrub email-delivery + app logs of any Trip identifiers/PII; rotate.
4. **Destroy the Vault transit key `trip-<tripId>`** — the decisive step: any residual copy in DB/MinIO backups is now permanently unreadable.
5. Set `trip.phase = erased`, write `audit_log(action=erasure_fired)`.
6. `result` (reviewed team names or neutral labels only) and `audit_log` remain.

## State machine (trip.phase)
```
draft -> challenge -> voting -> reveal -> grace -> erased
                                                   ^
        hard_erase_at reached in ANY phase --------┘ (force)
```
- challenge->voting and voting->reveal: teacher-confirmed or auto at planned date.
- reveal->grace: after ceremony completes.
- grace->erased: auto after grace_days (teacher may fire early).
- any->erased: forced at hard_erase_at, with escalating warnings (7d/1d/1h, email + banner).

## Editability (config edits via `PATCH`)

Fields are editable *until the phase where the value becomes settled*. Two limits are safety locks (🔒), not convenience — see the reason column.

| Field(s) | Editable through phase | Reason for the limit |
|---|---|---|
| `trip.name` | any (`≠ erased`) | cosmetic |
| `trip.points_table`, `challenge.multiplier` | `< reveal` | only feed `computeResults`; frozen once results are computed |
| `challenge.title`, `challenge.instructions` | `< reveal` | text only; `qr_slug` never changes |
| `trip.challenge_opens_at` / `voting_opens_at` / `voting_closes_at`, `grace_days`, `trip_end_date`, `max_retention_days` | `≠ erased` | recompute `hard_erase_at` on write |
| **`trip.max_team_size`** 🔒 | **`draft` only** | teams lock at challenge start; shrinking it later would orphan formed members |
| **challenge add** | `< voting` | fine to introduce tasks mid-trip |
| **challenge delete** 🔒 | **`draft` only** | the QR is printed/distributed once the challenge exists — deleting leaves a dead QR in the wild |

Edits outside the allowed phase return `409`. `hard_erase_at` is always recomputed from `trip_end_date + max_retention_days` on write. All config edits are owner/co-teacher gated and audit-logged.
