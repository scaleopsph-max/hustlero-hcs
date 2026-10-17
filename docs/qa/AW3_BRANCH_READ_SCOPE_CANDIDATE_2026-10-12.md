# AW3 Branch Read Scope Candidate

Status: local implementation, database execution pending. Not a release sign-off.

## Scope

- Active owners retain reads across their own tenant, including inactive historical locations.
- Non-owners require active membership, an active linked employee and an active assigned location, in addition to existing permission and entitlement checks.
- Orders, inventory choices, invoices, receivables, order-specific approval history and statement entries are filtered by location.
- Explicit unauthorized statement/settlement locations fail closed with HCSD2.
- Settlement aggregation starts from permitted invoices, so totals and payment-method breakdowns do not include other branches.
- A restricted reader cannot see a whole payment header when any allocation belongs to another branch; an unallocated receipt also has no branch attribution and is hidden. Owners retain the original receipt projection. Scoped settlement sums allocations, not rewritten receipt headers.
- Tenant-level customer/catalog/pricing/payment-method masters remain unchanged. Historical approval consumption is an order-specific decision snapshot; whole-customer credit enforcement is unchanged.
- Original privileged read implementations are renamed and revoked from PUBLIC, anon, authenticated and Hyperdrive. Only scoped entry points are granted to Hyperdrive.

## Verification

Executed locally:

- `npm test`: 484 tests, 21 files passed.
- `npm run security:secrets`: passed across 439 tracked files; untracked candidate files are not covered by that script yet.

Authored, not executed:

- `advanced_wholesale_branch_read_scope.test.sql`: owner/reader/unassigned/foreign/suspended access, projection ordering, privileged-helper execute denial, mixed/unallocated receipt visibility, nonzero scoped aging/unknown totals, settlement reconciliation and order-branch approval history.
- `advanced_wholesale_payment_allocations.test.sql`: assigned/unassigned branch invoice/order/stock/receipt/statement/report reads, explicit-filter denial, inactive branch and retained owner history. Suspended-reader fixture now asserts no receipt visibility and restores active status before later report tests.

No local Docker or psql was found. Existing CI results predate this migration and do not validate it. Full migration reset, pgTAP, concurrency and release checks remain required.

## Next Safe Action

Complete database regression coverage and run disposable CI. After passing, release to Staging and grant only the approved single-branch read-only test membership, then run authenticated denial UAT. Do not use Production or live financial records to validate this local SQL candidate.
