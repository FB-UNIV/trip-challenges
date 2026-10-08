# Teachers may read their Trip's student emails back

Until now no teacher-facing route decrypted a Student's email: the Roster went in, and only counts came out. Teachers on staging could see "4 haven't joined, 1 email failed" but not *who*, so they couldn't chase a straggler or fix a typo'd address. We now decrypt, for a Trip's teachers only, each Student's email in the teacher's student list (with their Joined / Invited / Undelivered status and team), and let them resend a code or correct an undelivered address.

The school is the data controller (ADR-0004) and the teacher acts for it; they typed these addresses in themselves, so reading them back widens no one's knowledge. The email stays the only student PII we hold, under the per-Trip key (ADR-0001), and is destroyed at Erasure like before.

## Considered Options

- **Counts only, no per-student list** — no new decryption path, but the teacher can't act on "4 haven't joined"; rejected as it leaves the actual job undone.
- **Masked emails** (`l•••@school.fr`) — looks safer but isn't: anyone who knows the class can guess them, and it makes a typo impossible to spot.

## Consequences

- A new decryption path for minors' data, guarded like every teacher route (Trip membership; 404 for others).
- Safeguards: request logging redacts emails and never logs bodies — a test drives these routes, including failed mails whose errors echo the address, through the production logger. The response to a failed send is generic.
- The audit log records **actions** only (`access_code_resent`, `roster_address_fixed`, `roster_item_retried`), with opaque ids; viewing the list is not audited — teachers are already entitled to these addresses, and the audit log exists to prove what changed or was destroyed. Revisit if a school's DPO requires access logging.
- Per-student information stays deliberately thin: status and team only — no "last seen", photos or votes per student (no per-child monitoring).
