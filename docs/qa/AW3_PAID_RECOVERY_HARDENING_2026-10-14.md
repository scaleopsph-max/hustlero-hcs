# AW3 Paid Fulfillment Recovery Hardening

Date: 2026-10-14. Status: local full verification passed; exact-candidate CI pending. No live release or fresh paid-delivery command executed.

## Corrected Defect

The original browser validator matched order ID and aggregate delivered quantity, but a schema-valid paid response with an incorrect invoice total could clear the original pending command. Even matching order/quantity/amount did not bind the response to the requested invoice lines in authorized history.

The candidate now requires the returned paid invoice total to equal the original explicit payment amount. Before clearing paid pending storage, the workspace reads the existing authorized Orders context and verifies exactly one matching invoice: order, customer/location, sale, invoice number, amount, issue instant and exact requested order-line/quantity pairs. Duplicate, missing, malformed, mismatched or failed history reads retain the original pending key/body. Later cancelled order state does not block an exact historical replay. Ordinary unpaid/credit confirmation and fulfillment behavior is unchanged.

This adds no API endpoint, schema, permission grant or new payment behavior. Server-side authorization and atomic idempotency remain authoritative. It verifies an immutable invoice, not a provider settlement. The existing Orders read endpoint is already used by this workspace; no separate payment-history permission is introduced.

## Local Verification

Twenty-one regressions added for wrong paid amounts, wrong invoice identities/lines/quantities, duplicate/missing/invalid history, timestamp-offset equivalence, later cancellation and unchanged ordinary credit behavior. Three focused files passed 108 tests. Full `npm run check` exited zero: 589 application tests/25 files, 47 Node harness tests, secret scanning, formatting, lint, strict typechecks and all standard/Cloudflare builds. Dependency gate passed existing accepted build-only exceptions, not a zero-vulnerability claim. Isolated CI remains pending.

No browser execution of the new code, Staging deployment, new order/terms/payment/stock effect, access grant, token, migration or Production change is claimed.

## Proposed Fresh Paid Browser Batch: Not Approved Or Implemented

Read-only Staging preflight verifies the existing PABL0 owner, reseller, Main stock P-00001 three/P-00002 four, zero reservations, and the existing Wholesale list: PHP 800 per unit for the shared six-unit pricing group. No confirmed/partially fulfilled order is available to reuse. Original customer settings are revision 7, Net 7 / PHP 5,000. Proposed order numbers and paid references below are absent.

Proposed scope uses two sequential synthetic six-unit orders, each two P-00001 plus four P-00002, PHP 4,800 per order. Each delivers only one P-00001 unit for exact Cash PHP 800, then cancels its undelivered five-unit remainder. First cancellation must release reservations before confirming the second order. This respects the six-unit pricing rule without a price change, new stock or fictitious refund.

| Case | Order number | Paid reference | Customer terms at confirmation |
| --- | --- | --- | --- |
| COD | SO-AW3-FRESH-COD-20261014-R1 | AW3-FIRSTCOMMIT-COD-20261014-R1 | COD / PHP 5,000 |
| Prepaid | SO-AW3-FRESH-PREPAID-20261014-R1 | AW3-FIRSTCOMMIT-PREPAID-20261014-R1 | Prepaid / PHP 5,000 |

Controlled diagnostic implementation is still required. Normal forms must generate/persist each new fulfillment key/body before its first HTTP request; one validated fresh committed response withheld per case, independent effect verification before normal reload/original-key retry, no pending injection or Auth extraction. Proposed maximum window 60 minutes, four paid-fulfillment POSTs total, maximum thirteen mutation POSTs including three exact terms revisions (COD, Prepaid, restore Net 7), two draft saves, two confirmations and two remainder cancellations. Any uncertain setup command stops for reconciliation rather than blindly using a fresh key. If an order remains draft, retain inert history instead of attempting unsupported cancellation. Do not cancel unresolved pending fulfillment or overwrite concurrently changed customer settings.

Expected persistent effects if separately approved: two new paid sales/invoices/receipts, PHP 1,600 synthetic received total and zero resulting debt; P-00001 Main stock three to one, P-00002 Main four unchanged, Branch 2 two unchanged, zero final reserved/transit. No fund allocation, real delivery/cash, pricing change, inventory replenishment or destructive cleanup. Original customer Net 7/PHP 5,000 terms restored through an explicit new revision, not by deleting history. Orders/terms/reservation/cancellation/payment/invoice/stock/audit/outbox records remain append-only UAT evidence.

Release prerequisites: reviewed exact scope approval, controlled diagnostic implementation plus full local checks/exact CI, renewed full baseline/feature-window check, temporary Staging Back Office-only exact-commit release, live asset verification, independent per-case reconciliation and clean immutable baseline restoration. No Production, API/POS/Admin release, migration, new access/token/paid project or B/tester reactivation. This document is a proposal, not authority to execute those changes.

Next after this candidate: obtain explicit approval for that bounded fresh paid scope or an explicit release coverage decision; do not infer approval from general "proceed" or the completed payment/fund batch. Final Gate 5 and AW3 Production approval remain separate.
