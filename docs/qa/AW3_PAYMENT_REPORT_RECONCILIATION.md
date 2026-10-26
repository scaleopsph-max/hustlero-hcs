# AW3 Payment Report Reconciliation

Date: October 26, 2026, Asia/Manila.
Source-only follow-up on draft PR #8; target remains the isolated AW3 candidate,
not main. No migration/deployment or execution-policy change.

Subsequent source follow-up: the shared formatter limitation below is now addressed
by qa/SHARED_MONEY_DISPLAY_EXACTNESS.md. The original report increment and its
verification boundary remain recorded here; no hosted rollout is implied.

## Defects And Boundary

At the supported safe-integer boundary, the receipt row used the shared formatter's
floating-point division: 9007199254740991 minor units displayed as .90 rather than
the exact .91 used by report totals and CSV. The report row now uses its existing
BigInt decimal formatter, consistent with the report's summary/export. No stored
amount, financial command or calculation changed. The shared formatPeso helper
is not modified; its extreme-amount behavior on other screens remains a separate
scoped follow-up, not something this report-only fix claims to resolve.

Loaded report scope now includes POS/wholesale channel as well as date/branch.
Changing the component's channel cannot show/export the previously loaded channel's
rows; an explicit refresh requests the correct endpoint/channel. Existing user/
tenant scope checks and method filtering are retained. CSV columns are unchanged.

## Executed Checks

Six new regressions cover exact receipt decimals at safe-integer boundaries and
independent same-suffix receipts whose recorded/reversed/net amounts reconcile
with parsed CSV. Existing scope test now covers both channel-switch directions.
Focused report/CSV suite: 26 tests passed.

Synthetic actual-component Playwright/Edge checks passed: exact row/summary and
downloaded CSV at the safe boundary; method-filtered two-receipt CSV with equal
0047 suffixes; totals reconciled with BigInt; changed date/channel hides prior
rows and disables export; refreshed POS endpoint/channel correct; failed refresh
prevents stale export; desktop/mobile screenshots and no page overflow. Auth/API
mocked, no hosted data or settlement proof. Initial browser selector was corrected
to match the native label's full name before the final passing batch.

Original credit/opening/payment and funds browser batches reran and passed. An
initial typecheck rejected a widened channel string; explicit scope typing fixed
it. Final full npm run check passed: 749 app tests / 38 files, 47 simulated
harness cases, format/lint/typecheck, standard and Cloudflare dry-run builds.
Exact-head CI remains pending at this source checkpoint.

No new receipt, reversal, customer term, inventory/fund movement, role grant,
credential, SQL/API/domain/contracts/lockfile change or hosted acceptance claimed.
Temporary harness and screenshots remain ignored under tmp/aw3-funds-browser.
