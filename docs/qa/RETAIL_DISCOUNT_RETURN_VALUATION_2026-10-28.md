# Retail Discount Return Valuation — October 28, 2026

## Source increment

`quoteRetailDiscountReturn` uses complete immutable original sale header/line
snapshots and committed cumulative refund quantities/amounts. It accepts no
current price, current discount definition, manually entered refund amount or
tax rate. It validates header sums, per-line net amounts, original stable
cumulative discount allocation and all prior net refund history before quoting.
It is a pure computation, not an API endpoint or payout authorization.

Partial refund entitlement is original net line cents times cumulative returned
milli-quantity, rounded half-up; subtract prior refunded cents. Thus 160 cents
returned in thirds produces 53, 54, 53, and a full selection recovers exactly
the original paid cents. BigInt intermediates avoid floating-point multiplication.
Stock disposition never changes valuation. Missing/foreign/duplicate lines,
overreturns, corrupt history, excessive money and selected zero-cent entitlements
are rejected. The existing zero-only refund policy remains unchanged.

Payment exhaustion is reported separately from physical unreturned quantity.
Neither flag authorizes a business status transition, stock posting or a free
restock. Zero-net lines and sub-cent remaining quantities still need the existing
conservative posting guard; this increment does not silently invent their policy.

## Verification

The earlier complete POS sale candidate is `2c3a4caad82ad34061a093be27ad049810cd5108`:
both exact CI workflows succeeded with 1,390 app cases, 2,197 SQL assertions,
concurrency and builds. This new domain increment is a separate local checkpoint.

Initial focused quote tests passed 75 cases across existing sale-discount and new
return files. Initial full regression passed 1,423 app tests and 47 simulated
harness cases. A final additional regression explicitly distinguishes payment
exhaustion from remaining physical stock. Final verification is recorded in the
current project state; no new SQL assertion/concurrency/build result is inferred
from the domain-only tests. Final local regression passed **1,424 app tests / 73 files**
and **47 simulated harness cases**, workspace-wide typecheck and lint. Changed-source
formatting passed. The tracked-file secret scan passed across 659 existing files;
new files are local/untracked and no push occurred. No build/SQL/live verification
was run for this domain-only increment. The exhaustive small-price case exercises 1,650
ticket/discount combinations with three sequential returns for each.

## Remaining integration

The old cash reversal SQL still rejects discounted/taxed sales. It has not been
modified. Before removing that guard, add server-side immutable snapshot/history
valuation under ordered sale/payment/register/inventory locks; keep tenant,
branch, current permission and suspension checks on commands and cached replays.
Preserve append-only reversal/payment/cash/stock/loyalty/audit/outbox effects and
original-key retry behavior. Validate net refund previews, receipt/report
breakdowns, mixed/online-payment denial, loyalty reversal, actual multi-session
races and disposable migration tests. Never route a discounted sale through the
old gross-unit-price refund computation.

No hosted migration, deployment, live financial test, credential, new access,
resource or frozen AW3 runner change occurred. No merge approval is inferred.
