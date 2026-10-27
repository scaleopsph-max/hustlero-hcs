# Catalog Import Processing Increment

Continuation of the owner-approved catalog import slice. Source development/QA
only; no hosted migrations, deployment, financial command or policy workaround.

## Bounded Processing

- Existing ceiling: 5,000 rows and 6 MB transport / 5 MB CSV file.
- One product group per asynchronous request, at most 100 rows in that group.
- Existing product IDs unify parent-SKU aliases. New products group by explicit
  product SKU. Parent creation runs before dependent variants, not file order.
- Invalid rows or oversized groups block confirmation of the whole prepared job.
- Fresh authorized review recomputes the domain plan. A changed plan requires a
  new saved preview. A server-derived review hash binds the actor, job and exact
  current catalog state, including current prices/costs/barcodes and categories.
- Confirmation stores the immutable reviewed groups/baselines. Each group is
  revalidated under catalog row locks immediately before its atomic transaction.
- Successful groups retain actual created/updated row identities; failed groups
  roll back all product/variant/audit/outbox writes in that group and retain
  sanitized failed row results. Authorization, unknown and infrastructure failures
  do not become ordinary row failures or automatically advance the job.
- Execution ID plus explicit group index is the retry identity. A lost response
  never means processing the next group. Confirmation has an actor-bound key.
- The browser may drive bounded sequential requests and pause/resume from durable
  state. No browserless background-worker guarantee is implied in this increment.
- Cancellation is available before confirmation only. After confirmation, pause
  leaves committed results intact; no destructive rollback or automatic reversal.
- No stock writes, category creation, name-based matching or auto price binding.

## Verification Required

New/update/multi-variant exact cents; reversed parent order; shared product aliases;
no category auto-create; stale price/barcode/category; same-index overlap; lost
confirmation/group responses; all-or-nothing group failures; revoked/suspended/
expired access after waits; cross-tenant/reader/foreign job denials; immutable
results; counts/identity reconciliation; standard builds and isolated reset/CI.
