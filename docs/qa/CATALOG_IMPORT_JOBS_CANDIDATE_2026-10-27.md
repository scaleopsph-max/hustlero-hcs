# Catalog Import Prepared Jobs Candidate

Source-only continuation of the approved five catalog/operations slices. Base
13663578d66da367e95163221565867156003535 passed both exact CI runs yesterday.
No hosted migration, token, access grant, financial command or deployment.

## Implemented Scope

- Save a server-recomputed preview as a tenant-scoped immutable job and rows.
- Retain original filename/raw rows/uploader/UTC timestamp and exact planned rows.
- Counts explicitly describe proposed creates/updates, not successfully posted items.
- Latest 50 job summaries omit raw input. Authorized exact-ID detail restores the
  complete saved preview. Catalog management authority is required for both.
- At most 5,000 rows / 6 MB request; existing CSV browser limit remains 5 MB.
- Actor-bound request-key replay checks the original raw request digest, never
  substitutes a newly computed preview after a lost response, and never revives
  a cancelled job. Access is rechecked after request-key and row lock waits.
- Job cancellation is explicit, naturally idempotent and preserves history. Each
  preparation/cancellation emits its own audit/outbox once. Browser/API login
  roles cannot directly write tables; private functions enforce live access.
- Browser persists the original key/body before sending, stops on storage error,
  retains unknown outcomes, restores after remount, and clears only after exact
  source/detail reconciliation. No automatic retry or silent pending discard.
- Actual import history page shows saved rows and exact money, permits explicit
  cancellation, clears stale data on errors and rejects wrong-job responses.

This is NOT the posting engine: no confirmation, worker claim/lease, batch product
writes, successful-created counters or Import/Post control exists. Subsequent
posting must revalidate the saved preview against current catalog, define bounded
asynchronous product-group processing, and persist atomic outcomes/recovery.
Stock remains exclusively in opening/movement workflows, never catalog import.

## Verification Record

Initial focused run found missing public contract exports; fixed without loosening
validation. The remount test initially used an upload-enabled helper incompatible
with the intentionally locked pending form; changed the test to await Retry save.
New focused coverage includes API authorization/forged body/size/errors, exact
source reconciliation, pending-storage/lost-response recovery, explicit history
cancellation, denied refresh/account change and StrictMode effect replay.

Actual component browser checks passed at 1440x1000 and 390x844: real CSV/domain
planning, mocked Auth/API job persistence, saved preview/detail, explicit cancel,
retained cancelled history after reload, no document overflow, page error or
external request. This is not hosted Auth/database acceptance.
Final local checks and exact candidate CI results must be recorded after actual
execution. Added disposable-database assertions for job immutability,
actor/key conflict, tenant isolation, permissions, cancellation/replay and zero
product/stock writes. Added three independent-session races for save/cancel once
and wallclock-expired replay. SQL execution is not claimed before CI passes.

No frozen AW3 hosted execution helper or applied migration was changed. The new
migration was generated with the pinned Supabase CLI; it is not applied remotely.
