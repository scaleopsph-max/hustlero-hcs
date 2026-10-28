# Inventory count preview — source checkpoint

The pure preview computes counted minus snapshot on-hand in integer milli-units,
checks exact line identity and detects stale snapshots from either version or
on-hand changes. It does not authorize a user or write inventory. The caller
must load tenant/location and current balances from authenticated server context,
under the appropriate locks, and must not treat the preview as permission to post.
It currently bounds the preview to 500 selected lines; this is an implementation
limit, not a claim that a complete count workflow exists.

The owner selected Owner/Manager creation and posting, with authorized staff
entering counts. Lifecycle persistence, explicit staff permissions, draft/submit,
branch-scoped database/API/UI, recount/revalidation, adjustment approval rules,
atomic append-only ledger posting, recovery and concurrent integration tests are
still required. No database migration, API, UI or live change is present here.

Owner confirmed one whole-count approval when any variance exceeds the existing
threshold; approval does not post stock, and Owner/Manager separately posts the
complete count. A changed snapshot/count cannot reuse old approval.

The independent draft/count-entry source candidate adds strict server-facing
contracts, a policy helper and SQL/API for manager/owner draft creation and
explicitly authorized staff entry. SQL and API contain no posting action.
31 focused domain/contracts/API tests passed; domain/contracts/API typechecks and
targeted lint passed. SQL tests have been written but not executed. Full project
CI has not run for this local, uncommitted candidate.
