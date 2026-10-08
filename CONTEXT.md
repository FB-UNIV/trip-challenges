# Context — Trip Challenges

Glossary for the school-trip challenge PWA. Terms only. No implementation.

## Ubiquitous Language

### Student
A minor participant on the trip. Identified by a personal **Access Code** delivered to their email. Not a full account (no password). Holds PII: email.

### Teacher
Organizer. Configures Challenges, manages the trip lifecycle (challenge period, voting period, erasure), moderates Nominations. Elevated privileges. A Trip has one **owner** Teacher (its creator) who may invite **co-teachers** with equal management access to that Trip.

### Access Code
Opaque per-student secret emailed to a Student. Authentication mechanism for Students. Sourced from the Roster. **Single-use**: redeeming it establishes a long-lived, device-bound session; the code is then spent. A Student who loses/changes device requests a fresh code to their email; **redeeming that new code invalidates the prior session** (requesting alone does not — so a stranger who knows the email cannot log the Student out without also reading the emailed code). Not a standing shareable password. Valid only until that Trip's Erasure. The code is human-typed, so it is hashed with argon2 (slow KDF). The device session token it yields is 256-bit random and is checked on every request, so it is stored as a SHA-256 hash: a slow KDF adds nothing for a secret that cannot be guessed (#64).
_Avoid_: password, login, PIN (it is not a chosen credential).

### Joined
A Student has **Joined** once they have redeemed an Access Code on a device at least once. Requesting a fresh code later (lost device) does not undo it. A Student who was emailed a code but never redeemed one is **invited**, not joined. A Roster address whose email could not be delivered never becomes a Student at all (**undelivered**).
_Avoid_: registered, signed up, active (a joined Student may not have opened the app since).

### Roster
List of student emails bulk-imported by a Teacher. School holds parental consent offline and is the data **controller**; this system is a **processor**. Roster emails are wiped at Erasure.

### Team
A voluntary grouping of Students, formed by Students themselves. Unit credited for Submissions. Rules:
- **Exclusive**: a Student is in exactly one Team at a time.
- **Solo allowed**: a Team may have a single member.
- **Fixed**: membership locks when the challenge period starts; free to form/join/leave only before lock.
- **Bounded**: 1..maxTeamSize, where maxTeamSize is set per Trip by the Teacher (default 4).
- **Named by Students, reviewed by a Teacher**: a Team name is free text and may identify Students. A Teacher may rename a Team at any time before the reveal and marks its name **reviewed** (renaming counts as reviewing). Unreviewed names are shown during the Trip and the ceremony, but never survive Erasure.

### Trip
The top-level container for one school trip and the isolation boundary. Owns the Roster, the Challenges, the config (e.g. maxTeamSize, points table), and the lifecycle phases (challenge period -> voting period -> Erasure). Everything is scoped by `tripId`. Created and owned by a Teacher; a Teacher only sees their own Trip(s). One deployment hosts **many Trips, possibly concurrent**; each Trip has its own encryption key (per-Trip blast radius). A given student email may appear in two Trips' Rosters — those are **separate** Students with separate Access Codes; no data crosses Trips.

### Challenge
A task configured by a Teacher, completed by submitting a photo. Attributes: title, instructions/description, one bound QR Code, and a **multiplier** (default 1; e.g. 2 for a "boss" Challenge) that scales its Grand Champion points. Scoped to a Trip.
_Avoid_: task, quest, mission.

### QR Code
Static printed code bound to one Challenge (encodes a URL to that Challenge; printable once). Scanning opens the Challenge page. Upload requires an authenticated Student session (via Access Code); the Submission is attributed to the Student's Team. Scanning alone grants no access.

### Submission
A photo uploaded by any member of a Team in response to a Challenge. A Team may have many Submissions per Challenge. Subject to erasure. Any team member can upload. Source: live camera capture OR device gallery.

During the challenge period a Submission is visible only to its own Team; non-nominated Submissions stay team-only forever (never public). It becomes public only if Nominated **and** Approved by moderation, at voting time. **Teachers of the Trip can view and remove ANY Submission at any time** (not just Nominations) — so inappropriate uploads that never get nominated are still catchable.

### Moderation
Two layers. (1) **Nomination review**: a Teacher reviews Nominations before the Voting Period opens; only **Approved** Nominations become votable/public (states `pending -> approved | rejected`); a rejected Nomination is not shown and the Team may re-nominate while the challenge period is open. (2) **Standing oversight**: a Teacher may view and remove **any** Submission in their Trip at any time, independent of nomination — the child-safety backstop for content that never enters the nomination flow.

### Nomination
The single Submission a Team selects (per Challenge) to enter the Voting Period. Only Nominations are votable. If a Team hasn't nominated when voting opens, the **latest** Submission is auto-nominated. Non-nominated Submissions are **kept until final Erasure** (allows re-nomination while challenge period is open).

### Voting Period
Phase after the challenge period. Authenticated Students vote to elect a Winner per Challenge. Mechanic is **pairwise (Tinder-style duels)**: a voter is shown two approved Nominations from the same Challenge and picks the better; repeated over rounds. Constraints: no self-voting (a voter is never shown a pair containing their own Team's Nomination), results hidden until the period closes.

### Duel
One pairwise comparison: two Nominations of the same Challenge shown to a voter, who picks one. Produces a win for the chosen Nomination and a loss for the other. The atomic unit of voting (there is no single "one vote per voter"). Pairing: **least-compared-first** (pick the Nomination with fewest comparisons) vs a random eligible opponent, excluding the voter's own Team; a given pair is not repeated to the same voter. Voters may Duel **unlimited** times per Challenge; the system keeps steering them to under-compared pairs. Because a voter is never shown their own Team's Nomination, a Challenge needs **at least 3 Teams** with approved Nominations before any Duel can be formed — with 2 Teams every voter is one of the two participants, so no valid pair exists and voting cannot proceed.

### Ranking
Per Challenge, each Nomination accrues a win/loss record from Duels. Score = **Wilson lower-bound** on win-rate (wins / total comparisons), so unequal/low comparison counts are handled fairly.

### Winner
The Nomination (and its Team) with the highest Ranking score for a Challenge. Tied Ranking scores **share the placement and its points** (standard competition ranking: two firsts → next is third); per-Challenge ties are **not** hand-broken by the Teacher. One top placement per Challenge (possibly shared).

### Grand Champion
The overall Trip winner. Each Challenge yields a placement order (from Ranking). The Teacher configures a **points table** per Trip — default depth **top 3** (1st=5, 2nd=3, 3rd=1), rest 0; depth and values editable. Per Challenge, placement points are scaled by the Challenge's **multiplier**, then summed across all Challenges per Team; highest total is Grand Champion. A tie for Grand Champion is broken by an explicit **Teacher** action during the ceremony (all tied Teams surface as co-champions until the Teacher picks one) — this is the **only** tie the Teacher hand-breaks. Results are computed at voting close but revealed via a **teacher-paced ceremony**: a single **shared reveal** (one screen — a projector/room), stepped one Challenge at a time by the Teacher. It is **not** synchronized to each Student's device. Results are **not publicly viewable** until the Teacher completes the ceremony; only then does the full results page unlock (and stays a public keepsake through Erasure).

### Lifecycle
A Trip moves challenge period -> Voting Period -> Erasure. The Teacher sets planned dates (challenge opens, voting opens, voting closes); the Trip auto-advances into the challenge period and into the Voting Period at those dates, or earlier when the Teacher advances by hand. At the voting-close date voting stops, but the reveal ceremony always starts with a Teacher's click. Erasure auto-fires after the grace window; a Teacher may fire it early.

### Erasure
Irreversible destruction of all Student PII and Submissions for a Trip. Core requirement (minors' data).

**Trigger**: voting closes -> Winners shown -> a teacher-configured grace window elapses (default e.g. 7 days) -> automatic wipe. A Teacher may trigger it early. **Hard fallback deadline**: a Trip is force-erased at `tripEndDate + maxRetention` (default 30 days) **regardless of lifecycle phase** — even mid-challenge or mid-voting — so neglected data cannot linger. Teachers are warned before it fires.

**Scope** — destroys:
- All Submission photo blobs (object storage) — **including Winners' photos** (a minor's face is personal data even without a name).
- All student/team/vote/duel DB rows and Roster emails.
- **Backups & snapshots** — achieved via crypto-erasure: each Trip encrypted under a per-Trip key; Erasure destroys the key, rendering any residual backup unreadable (rather than chasing every snapshot).
- **Logs & email-delivery records** — scrubbed/rotated so no residual student PII survives.

**Survives** (non-personal only):
- A results record such as "Team FOX won Challenge 3" — Challenge title + winning Team name, **no image, no student identity**. Only a **reviewed** Team name survives; an unreviewed one is replaced by a neutral label ("Team 3") at Erasure.
- The **teacher-action audit log** (e.g. "teacher removed a Submission at T", "Erasure fired") — **PII-free by design** (references opaque IDs and teacher identity, never student PII), which is precisely why it may survive.

## Open Questions
Domain model settled. Remaining items are minor / implementation-level:
- Co-teacher invite mechanism (email invite? link?).
- Channel + timing of the pre-Erasure warning to Teachers (email?).
- Are all Challenges equal weight for Grand Champion, or can a Challenge carry a multiplier? (currently: equal, single global points table.)
- Abuse/rate-limiting specifics on Duel submission and Access Code redemption.
