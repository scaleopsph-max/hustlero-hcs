# Workforce Branch Read Scope

Review base: `850ad2662d8625a5c34a4c66e9b37e5a90410f68`.

The latest workforce projection (`20260924142056_workforce_employee_role_context`) checked active membership and workforce capability, but returned tenant-wide employees, assignments, locations and registers. API/repository tenant resolution supplied no independent allowed-location filter. This contradicts the locked branch authorization requirement. No live exploit or account/access change was executed.

Migration `20261017133607_workforce_branch_read_scope` retains existing membership/capability checks behind a private core. Non-owner location/register rows are filtered using the established active-employee/assignment predicate. Employees must share an allowed branch, and their other assignment IDs are removed. Owners retain complete workforce maintenance projections, including inactive locations. Shared role-template configuration remains unchanged; no role-name authorization shortcut or new grant is introduced. Commands remain unchanged, not implicitly enabled for a reader.

Disposable SQL regressions cover assigned and multiple branches, unrelated/shared employees, assignment-ID trimming, reassignment removal, inactive employee/location, owner maintenance, foreign/suspended memberships, capability removal, absence of credential hashes and private-core/API grants. Full exact-source CI execution is required before any verification claim. Local Docker is unavailable; no shared database was used for development.

This is a bounded workforce-read correction, not a complete role-matrix or Alerts/Audit review. Existing own-activity versus branch-wide role-policy distinctions still need explicit review; no broader readiness claim is made. Preserve business/HR history on rollback and do not re-expose the old unscoped core. Reviewed-main incorporation, coordinated Staging migration/app UAT and Production approval remain separate.
