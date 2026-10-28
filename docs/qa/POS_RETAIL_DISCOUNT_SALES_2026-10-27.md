# POS Retail Discount Sale Candidate

Approved Discounts v1 continuation from configuration candidate 90e7dd5. Source
and isolated QA only; no hosted migrations, credentials, financial UAT or deploy.

## Implementation

- POS context exposes only this tenant's active definitions when the actual
  employee has discounts.apply and sales.create. No Back Office owner/session
  substitution. New discounted entry derives tenant/device/register/location and
  employee from the hashed POS session, locks live security/feature/assignment
  rows, checks clock time after waits, and checks current access before replay.
- Requests select only discount UUID + expected revision. Server chooses the
  version/value and computes gross, half-up discount and positive net payable.
  Wholesale/dealer/mixed, nonzero tax and stacking are blocked. No redemption is
  posted by this checkout. Normal checkout continues to ignore caller prices/
  totals and uses its existing SQL entry point.
- New private discounted core retains existing category pricing, stock and
  payment business rules, inserts net payments/cash movements and earns points
  from actual net spend in one transaction. It never posts gross cash and then
  rewrites an immutable ledger. The legacy priced core is unchanged; duplicated
  logic must stay aligned until a separately reviewed shared-core refactor.
- Header and per-line append-only snapshots reference the original definition
  revision and sale-line parent identity. Allocation uses stable original sale
  line UUID ordering and cumulative numeric cent rounding. Gross sale-line
  amounts remain original snapshots; line net/discount are separate projections.
- Current active definition/revision is required for new effects. Historical
  exact retries return the original receipt even after definition archive/edit,
  with current cashier/scope permission still required. Server request hash binds
  actor/device/register/location and full original business body, without tokens.
- Bank/wallet references still require exactly four digits; leading zeros are
  retained in immutable records and the discounted receipt. Missing suffix is a
  distinct no-effect error so an explicitly rejected attempt can be discarded.
- Checkout persists canonical key/body/scope before any POST. Reload/manual retry
  sends exactly the same request. Corrupt/replaced storage, receipt mismatch,
  identity changes, key conflict, unknown outcome and unmount retain recovery.
  Successful proof is checked before pending cleanup; unrelated carts are kept.
  A pending device attempt blocks another cashier in the same browser session.
  This is sessionStorage recovery, not a cross-tab/device or offline work queue.
- Definition selection freezes after payment allocation; remove payments to
  change it. Mobile header wraps context instead of overlapping controls.

## Executed Local Evidence At This Checkpoint

- 79 focused preview/contracts/API/recovery/checkout tests passed across five
  files, including 14 actual checkout DOM workflows. Existing POS/API tests also
  passed in an earlier 105-test run.
- Targeted lint and POS/API/contracts typechecks passed before final follow-ups;
  final full repository checks pending.
- Actual checkout at 1440/390 with isolated mocked Auth/API persistence: exact
  PHP 10 gross / PHP 1 discount / PHP 9 payment, one effect after response loss,
  reload and identical-key/body retry. No page errors, external calls or document
  overflow; checkout/receipt screenshots inspected. Mobile header corrected and
  rechecked. First browser attempt only hit a not-yet-ready local server.
- Self-review added unmount, cleanup-failure and rapid-selection regressions.
  An intermediate DOM run observed the old 10.00 allocation after selecting the
  9.00 payable; discount selection now sets exact amount/tender synchronously,
  with a rapid-switch regression. Final focused tests passed; no test weakened.

## Database Verification Pending

No Docker is available locally. New SQL tests exercise fixed/percent/fractional
valuation, header/line equations, shared stock, cash/change, net-spend loyalty,
references, immutable original replay, permission/tenant/expiry denials,
wholesale/dealer/mixed denial and atomic rollback. Existing discounted reversal
guard remains explicitly tested. New loopback-only CI races exercise one-effect
replay, queued revision change, revoked cashier, register-lock session expiry
and tenant suspension, comparing financial/stock/idempotency/counter snapshots.
Migration reset, assertions, concurrency and exact CI must be verified.

## Remaining Release Boundary

Discounted refunds/voids and linked Back Office reports/receipt detail integration
remain next. Existing reversal restrictions are intentionally preserved; do not
roll this feature live as a complete discount/refund workflow. No source merge or
release authorization is inferred. Application rollback must retain all recorded
snapshot, ledger, audit/outbox and request history. Frozen hosted runner untouched.
