# Shared Reporting Branch Scope Candidate

Status: authored; local checks running, database execution and live release pending.

The owner chose shared report branch hardening before restricted-account UAT. This resolves the scope choice recorded in DECISIONS.md; it does not approve tenant-wide test access.

## Scope

- Ordered CLI-generated migration `20261012152656_reporting_branch_read_scope.sql` replaces four existing read functions: general reporting, inventory-policy reporting, channel reporting and shift reporting.
- Reuses the private active membership/employee/location-assignment predicate from the verified wholesale branch migration. Function permissions, security-definer search paths, API signatures and permission codes are unchanged.
- Sales/refunds, inventory, reorder counts, register counts, branch choices and shift rows are filtered before aggregation. Explicit same-tenant unassigned locations return HCSD2; cross-tenant and suspended memberships remain HCSD0. Owners retain existing tenant-wide behavior.
- No ledger mutation, frontend workaround, role grant or new database table. Existing API and CSV consumers receive scoped projections from the same entry points.

## Regression Evidence

New rollback-only pgTAP suite uses two same-tenant branches with different nonzero sales/refunds, inventory, reorder policies and register sessions. Checks cover four callable reporting functions, aggregate breakdowns, owner totals, foreign-tenant denial, explicit unassigned branch denial, employee suspension, inactive branch, reassignment, suspended membership and grants. Existing reporting suites remain intact.

No SQL test execution is claimed until isolated database CI passes. No Staging migration, tester provisioning or Production change has occurred for this candidate.

## Release And Recovery

Run the full local checks, fresh database migration reset, full pgTAP suite and independent-session concurrency harness before Staging release. Verify exactly this pending migration against the explicit Staging project. Reconcile unchanged business counts, owner projections, denied unassigned branch reads and security advisors, then provision the restricted tester and run authenticated UAT. Do not call this a live security pass based only on actor-parameter SQL tests.

For rollback, first deactivate restricted memberships to prevent reopening tenant-wide access. Restore the four previous definitions from migrations 20260925151555, 20260927074917, 20260927132034 and 20261008045840 through a new ordered correction migration. Do not delete migration history or restore financial data for a read-function rollback.
