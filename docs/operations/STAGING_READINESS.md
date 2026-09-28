# Staging Readiness

Last reviewed: 2026-09-28

## Decision

Staging infrastructure provisioning and public deployment smoke testing are complete, but staging is not ready for pilot invitations yet. The isolated Supabase project, Hyperdrive configuration, API, Back Office, POS, and Super Admin deployments exist; all committed migrations were replayed; and no production resource remains deployed. Leaked-password protection remains a pre-pilot security gate and is available only on Pro and above.

## Current gate status

| Gate | Status | Evidence or next action |
| --- | --- | --- |
| Application check | Pass | Formatting, lint, strict typecheck, 83 Vitest cases, standard builds, and Cloudflare builds passed locally. |
| Fresh database replay | Pass | GitHub CI replays migrations and pgTAP suites from a fresh Supabase stack. |
| Dependency and secret scan | Pass | High-severity npm audit and tracked-file secret scan are CI gates. |
| Development smoke test | Pass | Worker health is 200 and unauthenticated protected inventory posting is 401. |
| Tenant isolation | Pass | Database posture audit and tenant-selection regressions are recorded in the security audit. |
| Inventory cutover | Pass | Controlled preview, post, reconcile, ledger, audit, and outbox validation passed on the permanent test tenant. |
| Supabase leaked-password protection | Blocked | The organization is `tier_free`; the staging dashboard confirms this switch is available only on Pro and above. |
| Staging Supabase project | Provisioned | `HUSTLERO HCS Staging` (`sdfwdhbryjyfufgtfqmf`) is healthy in Singapore at the confirmed $0/month project cost. |
| Staging migration replay | Pass | All 46 committed migrations replayed from a clean remote reset with repository versions preserved. Direct posture checks passed; local invocation of remote pgTAP remains unavailable without Docker, while the same suites pass in CI. |
| Staging Hyperdrive and credentials | Provisioned | `hustlero-hcs-staging` (`008f24430d3e433eb478caaa52787fea`) uses a staging-only restricted login, SSL required, 20 origin connections, and caching disabled. |
| Staging API Worker | Pass | `hustlero-hcs-api-staging` version `334918bb-c38c-4374-b3fa-31c9890a21dd` passed dry run, health 200, unauthenticated cutover 401, and Back Office CORS 204. |
| Staging web applications | Pass | Back Office `eefeb035-2dd1-4c36-a729-4ec68aba7818`, POS `5cd5a760-199d-4f56-a2bd-3d412c7c5c83`, and Admin `b969c720-9d84-482e-a9cf-a689cdc50ba9` each returned 200 and rendered their expected unauthenticated entry state. |
| Staging Auth URLs | Pass | Back Office is the site URL; Back Office and Super Admin staging wildcard redirects are allowlisted. |
| Owner UAT | Not started | Begins only after staging smoke, security-advisor, and data-isolation gates pass. |
| Production | Not started | Production remains a separate manual promotion after UAT and recovery verification. |

## Provisioning order

1. Upgrade the organization to Supabase Pro before pilot invitations, enable leaked-password protection, and rerun the Security Advisor.
2. Keep the staging migration ledger synchronized with committed repository versions and rerun CI pgTAP for every schema change.
3. Retain the verified RLS, grants, and restricted Hyperdrive role posture.
4. Keep the staging-only Hyperdrive credential out of source control and rotate it if exposed.
5. Keep the staging Worker configuration scoped to the staging Supabase URL, Hyperdrive binding, and exact Back Office, POS, and Admin origins.
6. Run authenticated tenant-context smoke tests against the deployed staging API after the controlled UAT owner account is created.
7. Rebuild the three web applications with staging-only public configuration for every candidate. The generated vinext Wrangler config requires an explicit `--name <app>-staging`; `--env staging` alone is not sufficient after config redirection.
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

## Staging URLs

- API: `https://hustlero-hcs-api-staging.scaleopsph.workers.dev`
- Back Office: `https://hustlero-hcs-backoffice-staging.scaleopsph.workers.dev`
- POS: `https://hustlero-hcs-pos-staging.scaleopsph.workers.dev`
- Super Admin: `https://hustlero-hcs-admin-staging.scaleopsph.workers.dev`

## UAT exit criteria

- No critical or high defect remains open.
- Cross-tenant and cross-branch denial tests pass in the deployed environment.
- Every irreversible command is idempotent and produces the expected audit/outbox records.
- Opening inventory is reconciled before POS activation.
- Sales, refunds, inventory, shifts, and valuation reports reconcile to the source ledgers.
- Security Advisor has no unresolved warning accepted as a pilot blocker.
- Backup restore and previous Worker-version rollback are demonstrated and recorded.
- The owner signs off the release candidate before any production project is created.
