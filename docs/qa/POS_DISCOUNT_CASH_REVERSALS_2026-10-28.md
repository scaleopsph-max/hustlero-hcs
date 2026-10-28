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
read the original sale header and actual net refund ledgers; no historical data
is repriced. A separate discount-definition analytics report is still later work.

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

## Rollback

Revert new command routing/UI to a discounted-reversal block while preserving
all original snapshots and append-only refund/payment/stock/loyalty/audit history.
Never delete completed financial records or replace them with gross-price refunds.
