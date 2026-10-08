# Roster import with school as data controller

Student emails (minors' PII) enter the system only by a Teacher bulk-importing a roster; the system emails each Student an Access Code. The **school is the data controller** and holds parental consent offline; this system operates as a **processor**. This keeps the consent burden and lawful basis with the institution that already has the relationship with families, and bounds our PII to a single field (email) that is destroyed at Erasure.

## Considered Options

- **Students self-register their email** — rejected: collecting PII directly from minors would make us the controller and require an in-app parental-consent flow.
- **No email at all (teacher hands out codes on paper)** — the lowest-PII option and a genuine alternative; rejected in favour of emailed codes for distribution convenience, accepting the added email attack/erasure surface.

## Consequences

- We must never treat the roster as our own data: no reuse, no export, deletion at Erasure (including email-delivery logs).
- Team names and any free-text must be treated as potential PII and reviewed before appearing in retained (post-erasure) results.
- Hashing follows secret entropy: Access Codes (human-typed, short-lived) use argon2; device session tokens and co-teacher invite tokens (256-bit random) use SHA-256, because they are verified on every request and cannot be brute-forced offline (#64).
