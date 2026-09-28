# Security and Tenant-Isolation Audit - 2026-09-28

## Decision

The Phase 5 application and database security audit is complete for the current development scope. No critical or high application vulnerability was found. Staging/pilot remains blocked on the owner-controlled Supabase leaked-password-protection setting and a green CI run for this hardening change.

## Scope and evidence

- API authentication, server-resolved tenant selection, and multi-business ambiguity
- PostgreSQL RLS, grants, security-definer execution, and Hyperdrive privileges
- POS cutover command exposure
- Back Office Supabase session/client handling
- Tracked-file secret scan and npm dependency audit
- Existing cross-tenant, wrong-location, deactivated-user, support-access, and module authorization regression suites
- Supabase security and performance advisors

## Verified controls

- Every table in `app`, `audit`, `integration`, and `platform` has RLS enabled.
- `anon` and `authenticated` have no direct DML privilege on private business tables.
- `PUBLIC`, `anon`, and `authenticated` cannot execute private security-definer functions.
- `hcs_hyperdrive` has no direct private-table DML and reaches data only through reviewed functions.
- The legacy POS cash-sale function is not executable by Hyperdrive; the cutover-gated customer-aware command is executable.
- Existing pgTAP suites exercise cross-tenant catalog, inventory, approvals, customers, loyalty, reporting, alerts, notifications, platform, and support-access denial paths.
- `npm audit --audit-level=high` reports zero known vulnerabilities.
- The repository secret scanner reports no high-confidence secret in tracked files and now runs in the main check.

## Findings and remediation

| ID | Severity | Status | Finding and action |
| --- | --- | --- | --- |
| SEC-001 | Medium | Resolved | Inventory import post/reconcile silently selected the first membership when a multi-business user omitted `X-Tenant-ID`. Both commands now return `TENANT_SELECTION_REQUIRED`; regression coverage verifies no database command is reached. |
| SEC-002 | Medium | Resolved | Dependency and committed-secret checks were documented but not enforced. CI now runs the high-severity npm audit and the local tracked-file secret scan. |
| SEC-003 | Low | Resolved | Back Office modules instantiated concurrent GoTrue clients under one storage key. A shared browser client now owns session refresh; browser reload produced no new multiple-client warning. |
| SEC-004 | Medium | Owner gate | Supabase leaked-password protection is disabled. Enable it in Auth password security before staging/pilot user invitations. [Supabase remediation](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). |
| PERF-001 | Informational | Backlog | Supabase reports 25 pre-existing unindexed foreign keys. This is a performance and lock-contention follow-up, not a demonstrated tenant-isolation defect. Review against workload before adding indexes. [Advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys). |

The 57 RLS-without-policy advisor notices are intentional deny-all defense in depth for private, non-Data-API schemas. The application uses restricted server functions and explicit execution grants instead of browser table policies. [Advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Added regression gates

- `supabase/tests/database/security_tenant_isolation_audit.test.sql` fails if private-table RLS, browser grants, security-definer grants, Hyperdrive table isolation, reviewed policy count, or POS command exposure drifts.
- `scripts/secret-scan.mjs` scans every tracked repository file without printing detected values.
- API tests cover missing tenant selection on both irreversible cutover commands.

## Residual risk

- Local pgTAP execution is unavailable because Docker/Podman is not installed; the fresh-database suite must pass in GitHub CI before this change is accepted.
- Staging and production do not exist yet. This audit does not replace staging penetration, rate-limit, upload-malware, recovery, or load testing.
