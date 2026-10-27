# Catalog Import Execution Candidate

Approved catalog-import source increment based on bdd82ca, which passed both CI
runs with 1,111 app tests and 2,009 SQL assertions. No hosted action authorized.

## Implemented

Fresh domain-plan revalidation at both review and first confirmation; historical
confirmation retries use the original actor/key/hash without recomputing a plan
after successful product writes. SQL binds the reviewed catalog manifest and
rechecks it after confirmation and row-lock waits. Current prices, unit costs,
product/variant metadata, barcode ownership and categories are included; stock is
not. Existing product-ID and new SKU group identities have separate namespaces.

At most 5,000 input rows; one product group of at most 100 rows per posting request.
Aliases for the same product share a group. Parent creation precedes child rows.
Product/variant core commands are reused with derived exact request identities.
One failed child rolls back the entire group including its core audits/outbox;
sanitized failed results remain. Authorization/unknown failures do not get converted
into ordinary row failures. Each group has immutable per-row outcomes/identities,
one-effect group audit/outbox and durable next-group state. No stock is written.

UI: explicit review/confirmation, up to 25 sequential bounded group requests per
Continue action, pause after the current request, reload recovery, exact-index
retry for lost success, storage-before-send and independent detail reconciliation.
Cancellation is pre-confirmation only; no hidden rollback of committed groups.
Completed jobs show actual created/updated/failed row results. This is resumable
browser-driven asynchronous processing, not an unattended background-worker SLA.

## Verification Checkpoint

Focused API/helper/DOM suite: 48 cases passed after awaiting the new execution
lookup before the cancel control. Full app test phase: 1,152 cases / 61 files and
47 harness cases passed. Builds are pending at this document checkpoint.

Actual component browser checks at 1440/390 passed real CSV/domain planning with
mocked Auth/API execution persistence: review, explicit confirmation, grouped
results sharing a product ID, exact input prices/costs, no cancellation after
confirmation, terminal reload, cleared pending storage, no document overflow,
page errors or external requests. This is not hosted Auth/database UAT.

New isolated database suite and independent-session cases require execution before
SQL claims: parent ordering, exact cents, SKU update without cloning, stale price
before/after confirmation, atomic child failure, ordered groups, 100-row boundary,
101-row rejection, immutable results, permissions/tenant isolation, zero stock,
overlapping confirmation/step, stale edits while queued and expired/suspended
historical replay. Exact candidate CI results must be recorded after execution.

No applied/frozen migration, hosted runner, token/access grant, paid resource,
financial command, live deployment or main merge was changed.

First exact candidate 2d444b7: push 40439872746 / PR 40439876891 database job
failed during migration creation with SQLSTATE 42702 (ambiguous `value` alias in
the scope-state SKU extraction). Posting tests had not run. Corrected the new,
never-hosted migration with explicit raw/unnest column aliases before rerunning.
The app verification job/local full checks passed; this is not a database pass.
