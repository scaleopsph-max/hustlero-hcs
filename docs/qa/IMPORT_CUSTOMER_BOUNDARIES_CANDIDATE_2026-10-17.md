# Import And Customer History Boundary Corrections

Follow-up review of 204b1fc found tenant-only inventory-import preview/post/reconcile authorization and tenant-wide sale/loyalty receipt history in Customer projections. These bypass the locked allowed-location boundary despite corrected Sales and Reports endpoints. No live exploit or business mutation was executed.

The import candidate wraps the existing atomic cores with current management capability and whole-batch location checks, including completed retries. Posting/reconciliation responses bind the requested batch ID. An inaccessible preview raises inside the same transaction, rolling back preview rows, keys, audit and outbox. Unresolved input rows remain visible only to their creator or owner; resolved inactive/unassigned branch rows are not implicit tenant-wide authority. Mixed batches are never partially posted. Existing quantity, cost, immutable rows and cutover rules are retained; renamed unscoped cores are private.

Customer identity and spendable loyalty balance remain shared within a tenant. Purchase totals, visits, receipt detail and loyalty receipt history use the actor's current branch assignments; owner totals/refund arithmetic remain intact. No shared customer master or points ledger is split by channel/branch and no historical sale or ledger is rewritten.

Disposable tests cover denied preview rollback, assigned posting/reconciliation and exact costs, replay after assignment/capability removal, batch-ID rebinding, cross-tenant denial, execution ACLs, Customer aggregate/detail parity, shared points balances and branch metadata removal. Exact-candidate CI is required; no pass is claimed by this planning record.

Owner approved the PR #4 -> PR #1 -> main sequence for the preceding verified source. Hold that sequence until these follow-up corrections pass and the changed head is explicitly identified. No shared migration, deployment, access/token grant, paid project or financial UAT is part of this source correction. There are now fifteen post-AW3 Staging candidates (twenty-nine pending on the last Production version inventory), not the earlier thirteen/twenty-seven.
