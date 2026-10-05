# Crypto-erasure via self-hosted Vault per-Trip keys

Because this system holds minors' photos and PII that must be *completely and provably* destroyed at trip end — including any residual copies in database and object-storage backups — we encrypt each Trip's data-at-rest (Submission blobs + PII columns) under a per-Trip key held in a self-hosted HashiCorp Vault (transit engine). DB and MinIO backups therefore contain **ciphertext only, no key material**. Erasure is implemented as deleting that Trip's key in Vault, which renders every residual copy permanently unreadable.

## Considered Options

- **Per-Trip key stored in a DB column (wrapped by a global KEK)** — rejected: nightly DB backups capture the wrapped key, so destroying the live key does not defeat backups (a restored backup + surviving KEK reconstructs it). Fails the "completely erased" requirement.
- **App-managed KEK in a secret store (hand-rolled envelope crypto)** — viable if the destroyable key lives only in the secret store, but places audited key-lifecycle correctness on our own code.
- **Cloud KMS** — equivalent guarantee, but reintroduces the cloud dependency we avoid by self-hosting, and spreads minors' key material to a third party.

## Consequences

- Vault becomes a hard dependency and a single point of failure for reads during a Trip; it must be available (warm standby) and its own storage kept out of the DB backup set.
- "Erased" is defined as *key-destroyed*; there is no undo. A Trip's data is unrecoverable the instant its key is deleted — matching the requirement, but operationally unforgiving.
