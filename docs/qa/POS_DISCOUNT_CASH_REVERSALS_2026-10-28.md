# POS Discounted Cash Reversals — October 28, 2026

## Candidate boundary

Source-only continuation of draft PR #10; no merge or hosted release is inferred.
Migration `20261028003933` adds a private discounted-cash reversal path and receipt
snapshot projection. The normal legacy reversal implementation stays private and
unchanged. Existing caller-derived authenticated tenant/actor context and scoped
API remain; clients cannot supply price, discount amount or refund amount.

Only one original cash payment and an open original register are eligible for
new reversal effects. Taxed/unsupported snapshots, split/non-cash methods, invalid
history, excess quantities and zero-cent selections fail without posting. Before
exhausting the payment, all remaining physical quantities must be selected; a
zero-net line still blocks this first workflow. No automatic online payout or
free-stock return is introduced. Void remains full-sale only, not after partial
refund. This is not an expansion to taxed receipts or statutory discounts.

## Atomic effects and authority

Current active tenant, Sales feature/entitlement, membership, permission and branch
assignment are locked and rechecked, including after waits and before cached
responses. Requests are actor/sale/body-bound and serialized with the existing
reversal operation/key namespace. Sale, original register/payment and canonical
inventory row locks serialize competing refunds and register close. Changed-key
overreturns cannot pass after another command commits.

Complete immutable header/line allocations and prior refund amounts must reconcile.
Net-line cumulative half-up rounding matches the pure BigInt quote. Original
gross sale lines and discounts never change. Refund items, payment reversal,
cash movement, optional stock movement, existing original-net loyalty reversal,
audit and outbox commit together. Restock uses original sale tracking evidence
and original unit cost; weighted inventory cost follows the existing return
formula. A tracked return with missing/corrupt balance fails rather than skipping
the stock effect. New entries share an explicit effective timestamp.

## Back Office

The original definition name/version, gross/discount/net per line and net return
preview appear in receipt detail. The existing summary/report truth continues to
read original sale headers and actual net refund ledgers. Migration `20261028004951`
extends the private item/category payable helper to original POS net snapshots,
so breakdowns reconcile with summary/payment totals without repricing history.
Ordinary and wholesale valuations keep their existing path. A separate
discount-definition analytics report is still later work.

The form persists actor/tenant/sale/key/body/expected amount in sessionStorage
before POST, without credentials. Unknown responses, auth denial, conflicting key,
unexpected amount and missing receipt-history evidence retain the original request.
Reload retries identical key/body; no second payout is requested. Only a known
no-effect server validation/conflict allows explicit discard. Corrupt scope fails
closed. This is tab-session recovery, not offline/cross-device reconciliation.

## Verification checkpoint

62 focused domain/helper/actual-component DOM tests passed. These cover original
net preview, header/history mismatch, exact quantities, storage scope, lost first
success followed by reload/retry, mismatched response, missing history, explicit
no-effect discard and corrupt storage. Full local check is running at this
checkpoint. New pgTAP cases and five actual multi-session refund races are written;
disposable migration/reset/SQL/concurrency execution and exact CI remain pending.
No hosted database, transaction, credential/access grant, paid resource or frozen
AW3 runner was changed.

First isolated CI 40611014099 passed app/security/build checks and migration reset,
then correctly rejected the positive stock-return fixture's missing original unit
cost. The positive fixture now supplies explicit original cost; the earlier POS
sale suite retains a dedicated assertion that unknown-cost restock is denied.
No guard was relaxed. A bigint aggregate assertion and complete closed-register
fixture fields were also corrected during review. Final exact CI is pending.

Follow-up CI 40611472403 reached 36 new reversal assertions before correctly
rejecting reuse of a POS session invalidated by tenant suspension. Positive
fixtures now create fresh synthetic sessions; an explicit regression asserts
reactivation never revives the old session. No security invalidation was changed.
Review also separated POST rejection from a failed subsequent history GET: a
successful payout followed by a read conflict can never offer no-effect discard.
The added DOM regression passes; current focused helper/DOM suite passes 29 cases.

Discounted form requests include an optional per-line expected net amount as a
staleness precondition, never a payout override. The server recomputes original
net entitlement under locks and rejects any mismatch before posting, so another
partial refund cannot silently move the displayed rounding remainder. Exact
original replay still precedes new-effect validation. Older bodies without this
optional precondition retain server-authoritative valuation. A new SQL denial
and actual-form payload assertion cover this boundary.

Actual-component loopback-only mocked browser checks passed at 1440x1000 and
390x844: 53-cent original-net refund, discarded first response, reload and identical
key/body replay, one effect, no external requests/page errors/document overflow.
Receipt preview/recovery screenshots were inspected with Back Office body classes
and local font fallbacks. This is mocked UI verification, not live financial UAT.

## Rollback

Revert new command routing/UI to a discounted-reversal block while preserving
all original snapshots and append-only refund/payment/stock/loyalty/audit history.
Never delete completed financial records or replace them with gross-price refunds.
