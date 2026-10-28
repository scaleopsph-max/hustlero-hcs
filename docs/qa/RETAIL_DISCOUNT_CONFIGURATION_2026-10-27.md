# Retail Discount Configuration Candidate

October 27 source increment after the approved computation foundation 407bac1.
No hosted migration/deployment, token, access grant or financial transaction.

Implemented configuration schema/private API/Back Office manager at `/discounts`,
linked from Products. Existing Sales entitlement, active tenant/membership and
dedicated discounts.manage are checked under locks, including wallclock expiry
after waits. Default apply-only Cashier cannot manage definitions or inspect
private management history. Browser roles have no direct tables/functions.

Definitions retain immutable revisions; normalized unique names, optimistic
revision updates, archive-only lifecycle, immutable history. Commands are actor-
bound/idempotent with one audit/event per effect and one shared command timestamp.
Replay after later edits/archive returns its original snapshot. Current access
is required even for replay/history. API validates strict bodies, scope and keys;
private/no-store reads. Management is tenant-wide metadata, not branch sales data.

UI defaults new definitions inactive, uses exact-decimal money/BPS input, explicit
archive confirmation, latest-100 history and exact historical revision proof for
pending commands. Unknown outcomes retain original key/body in user/tenant session
storage. Auth/key conflicts cannot be dismissed as definitive command rejection.

Executed before CI:
- 55 focused API/helper tests.
- 13 DOM workflow tests (thread worker with explicit local hook/test allowance).
- Actual components in mocked browser at 1440/390: fixed create, discarded first
  response, reload/original-key replay, percent edit and historical versions.
  No document overflow, external requests or page errors. Mobile form width was
  corrected after screenshot inspection and rechecked.
- Initial default DOM fork worker timed out before starting tests; first thread
  attempt hit the import hook timeout. Neither is recorded as a test pass. The
  final bounded thread run executed all 13 tests successfully.

Full local checks, isolated reset/SQL/concurrency and exact CI are pending at this
checkpoint. No claim that SQL has run locally: Docker is unavailable on this host.
Candidate 95744da passed local full checks and the CI application job. Initial
SQL fixture incorrectly reinserted seeded tenant roles and failed before any new
assertion; corrected to bind the real seeded IDs, preserving the failed CI evidence.
Added >100-version exact-proof coverage alongside latest-100 history bounds.
Candidate aa10a0e executed 54 new SQL assertions without failures, then its expiry
fixture violated the existing starts-before-ends constraint. Corrected the test
window to start one day earlier and expire one second earlier; no schema constraint
or application guard was weakened. Full SQL/concurrency acceptance still pending.
New SQL tests cover permission separation/tenant denial, strict inputs, immutable
history, current/replay reads, revision conflicts, event counts and expiry. New
concurrency cases cover same-key effects, competing edits, queued tenant suspension
and entitlement expiry during row-lock wait, in the existing loopback-only CI runner.

Rollback is application routing/release rollback: disable entry to configuration
and retain definitions/version/audit/outbox/idempotency rows. Do not destroy saved
history or silently restore older mutable metadata over subsequent changes.

Still pending: POS discount selection and cashier authorization at checkout,
atomic discounted sale snapshots, partial/full refund integration and discount
reporting. Existing POS and refund rules are unchanged. This configuration
increment is not completion of the entire Discounts slice or live acceptance.
