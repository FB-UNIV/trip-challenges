# Security policy

Trip Challenges stores **minors' photos and personal data**. Security reports are taken
seriously and handled before anything else.

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub:
[**Report a vulnerability**](https://github.com/FB-UNIV/trip-challenges/security/advisories/new)
(Security tab → *Report a vulnerability*).

Please include what an attacker can reach (which role, which phase), steps to reproduce,
and the version or commit you tested. You should get a first answer within a week.

## Supported versions

Only the latest release receives fixes. Operators should track releases and upgrade with
`docker compose up -d` (migrations apply at boot).

## Especially in scope

- Anything that reads or keeps student data after a Trip's **Erasure** (crypto-erasure —
  [ADR 0001](./docs/adr/0001-crypto-erasure-with-vault-per-trip-keys.md))
- Cross-Trip access, or a student acting as a teacher / another student
- Student PII written to logs or stored outside the per-Trip encrypted scope
- Upload handling (malware scan bypass, content-type confusion, oversized files)

Out of scope: findings that need a compromised operator host, and denial of service by
volume against a self-hosted instance.
