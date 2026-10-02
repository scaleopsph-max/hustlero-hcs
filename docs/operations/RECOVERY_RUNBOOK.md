# Recovery Runbook

Last reviewed: 2026-10-02

## Scope

This runbook covers Supabase database recovery and Cloudflare Worker rollback. It does not treat an application rollback as a database rollback. Production execution requires an incident owner, a recorded recovery point, and explicit owner approval.

## Supabase database recovery

1. Stop write traffic or place the affected application in maintenance mode.
2. Record the incident time, desired recovery point, source project reference, and latest known-good migration.
3. Prefer **Restore to a new project** so the source remains unchanged while the recovered database is validated.
4. Use the latest backup before the incident. Record the backup timestamp and the generated project reference.
5. Keep the recovery project isolated. Do not attach Workers, web applications, Hyperdrive, queues, or external jobs during validation.
6. Verify project health, ordered migration history, schema/table/routine counts, Auth-user count, RLS posture, and validated constraints.
7. Compare rows carrying `created_at` with the source as of the backup cutoff. Reconcile inventory balances to movements, sales to lines and payments, refunds to items, register variance, tenant IDs, memberships, audit events, and outbox events.
8. Reconfigure items that Supabase does not copy: Storage objects/settings, Auth settings/API keys, Edge Functions, database extensions/settings, and read replicas.
9. Run Security and Performance Advisors. Expected clone-only Auth warnings must be resolved before the recovered project can serve traffic.
10. Promote only through a documented connection switch with a verified rollback point. Rotate generated database credentials after promotion.
11. Delete a drill-only recovery project after evidence is retained and the owner explicitly approves deletion.

## Cloudflare Worker rollback

1. Record the active and previous known-good version IDs with `wrangler deployments list --name <worker>`.
2. Verify baseline health, authentication denial, and allowed-origin CORS behavior.
3. Roll back with `wrangler rollback <version-id> --name <worker> --message <reason> --yes`.
4. Repeat the same smoke checks immediately.
5. If this is a drill, restore the release candidate with `wrangler versions deploy --version-id <current-version-id> --percentage 100 --name <worker> --message <reason> --yes`.
6. Repeat smoke checks and confirm the expected version receives 100% of traffic.

Worker rollback does not roll back Supabase, Hyperdrive, Durable Objects, R2, KV, Queues, or other bound resources. Use expand/migrate/contract database changes so the previous Worker remains schema-compatible.

## Required evidence

- Recovery point and backup timestamp
- Source and recovery project references
- Migration, schema, row-count, ledger, constraint, RLS, Auth, audit, and outbox checks
- Worker version IDs before, during, and after rollback
- Health, auth, and CORS results
- Advisor findings and accepted exceptions
- Recovery project cleanup confirmation

