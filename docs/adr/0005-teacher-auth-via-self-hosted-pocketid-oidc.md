# Teacher authentication via self-hosted PocketID (OIDC)

Teachers authenticate through the operator's self-hosted **PocketID** OIDC provider; the application stores **no local teacher credentials** and delegates MFA/passkey enforcement to PocketID. This keeps admin credentials (the highest-value accounts, able to configure Challenges and trigger Erasure) out of our datastore entirely, and reuses infrastructure the operator already runs.

## Considered Options

- **Password + mandatory TOTP** — rejected: makes us store and protect credentials for the most sensitive role.
- **Google Workspace SSO** — not applicable; the operator does not use Google and runs their own IdP.
- **Email magic links** — rejected for an admin role: security would reduce to inbox security.

## Consequences

- Availability of teacher login depends on PocketID being reachable; it is an external dependency in the auth path.
- Auth is coupled to PocketID/OIDC; swapping IdPs later is a real (though standards-bounded) migration.
