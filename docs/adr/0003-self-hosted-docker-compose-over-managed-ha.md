# Self-hosted docker-compose with warm standby, over managed cloud or k8s

We deploy the whole system (React PWA, TypeScript API replicas, Postgres, MinIO, Vault) as a self-hosted docker-compose stack with a warm DB standby and backups we own, rather than managed cloud services (RDS/S3) or a multi-node orchestrator (k8s/Swarm). The deciding constraint is *complete erasure of minors' data*: managed backends replicate data and backups across regions we cannot fully attest or purge, whereas self-hosting keeps every copy in infrastructure we control. Scale (a few classes over a few days) does not justify k8s ops overhead.

## Consequences

- "High availability" here means container auto-restart + a warm Postgres standby + owned backups — not zone-redundant, provider-grade uptime. Accepted trade-off given the scale and the erasure priority.
- A single host is still a failure domain; a second host (primary + standby) is the intended topology if uptime matters during the event window.
