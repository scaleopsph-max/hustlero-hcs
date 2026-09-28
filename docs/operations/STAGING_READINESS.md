# Staging Readiness

Last reviewed: 2026-09-28

## Decision

The codebase is ready to begin staging provisioning, but staging is not ready for owner UAT yet. No staging resource has been created and no production resource has been changed. Provisioning requires an explicit owner-approved paid Supabase plan because leaked-password protection is a pre-pilot security gate and is available only on Pro and above.

## Current gate status

| Gate | Status | Evidence or next action |
| --- | --- | --- |
| Application check | Pass | Formatting, lint, strict typecheck, 83 Vitest cases, standard builds, and Cloudflare builds passed locally. |
| Fresh database replay | Pass | GitHub CI replays migrations and pgTAP suites from a fresh Supabase stack. |
| Dependency and secret scan | Pass | High-severity npm audit and tracked-file secret scan are CI gates. |
| Development smoke test | Pass | Worker health is 200 and unauthenticated protected inventory posting is 401. |
| Tenant isolation | Pass | Database posture audit and tenant-selection regressions are recorded in the security audit. |
| Inventory cutover | Pass | Controlled preview, post, reconcile, ledger, audit, and outbox validation passed on the permanent test tenant. |
| Supabase leaked-password protection | Blocked | Current organization is `tier_free`; use a Pro staging project, enable the control, and rerun the Security Advisor. |
| Staging Supabase project | Not created | Create only after owner accepts the recurring plan cost. |
| Staging Hyperdrive and credentials | Not created | Create against the staging database after migrations and restricted roles are applied. |
| Staging Worker | Config only | `hustlero-hcs-api-staging` is named in Wrangler but has no URL, Hyperdrive binding, origins, or secrets yet. |
| Staging web applications | Not deployed | Back Office, POS, and Super Admin require separate staging origins and environment variables. |
| Owner UAT | Not started | Begins only after staging smoke, security-advisor, and data-isolation gates pass. |
| Production | Not started | Production remains a separate manual promotion after UAT and recovery verification. |

## Provisioning order

1. Approve the Supabase Pro cost and create `HUSTLERO HCS Staging` in Singapore.
2. Link the staging project and replay every committed migration from a clean database.
3. Run every pgTAP suite, then verify RLS, grants, Security Advisor, and leaked-password protection.
4. Create a staging-only `hcs_hyperdrive` credential and Hyperdrive configuration with query caching disabled.
5. Configure the staging Worker with its staging Supabase URL, Hyperdrive binding, and exact Back Office, POS, and Admin origins.
6. Deploy the immutable API candidate to `hustlero-hcs-api-staging` and run health, CORS, unauthenticated, and authenticated tenant-context smoke tests.
7. Deploy the three web applications with staging-only public configuration. Do not reuse development or production secrets.
8. Seed generated UAT tenants and users only. Do not copy customer or credential data from any real business.
9. Execute owner UAT: onboarding, catalog and variants, opening inventory cutover, purchasing, transfers, employees, register, POS sale/refund, customer and loyalty, reports, alerts, notifications, subscription controls, and support access.
10. Verify backup/restore, Worker rollback, audit/outbox integrity, and a final secret scan before requesting production approval.

## Required staging configuration

| Component | Required values |
| --- | --- |
| Supabase Auth | Exact site/redirect URLs, strong password rules, leaked-password protection, MFA for platform operators |
| API Worker | `ENVIRONMENT=staging`, `SUPABASE_URL`, staging Hyperdrive binding, exact application origins |
| Back Office | Staging Supabase URL, publishable key, and staging API URL |
| POS | Staging Supabase URL, publishable key, and staging API URL |
| Super Admin | Staging Supabase URL, publishable key, and staging API URL |
| CI/CD | Protected staging environment, scoped Cloudflare/Supabase credentials, manual promotion control |

## UAT exit criteria

- No critical or high defect remains open.
- Cross-tenant and cross-branch denial tests pass in the deployed environment.
- Every irreversible command is idempotent and produces the expected audit/outbox records.
- Opening inventory is reconciled before POS activation.
- Sales, refunds, inventory, shifts, and valuation reports reconcile to the source ledgers.
- Security Advisor has no unresolved warning accepted as a pilot blocker.
- Backup restore and previous Worker-version rollback are demonstrated and recorded.
- The owner signs off the release candidate before any production project is created.
