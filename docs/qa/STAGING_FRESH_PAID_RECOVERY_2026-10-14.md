# Staging Fresh COD/Prepaid Recovery Batch

Date: 2026-10-14. Status: exact scope owner-approved; controlled diagnostics implemented locally; full check/exact-candidate CI and live execution pending. No live pass claimed.

## Approved Scope

The owner explicitly approved two sequential PABL0 six-unit orders (two P-00001 plus four P-00002, PHP 4,800 each), one P-00001 partial paid delivery at exact Cash PHP 800 per case, withheld first committed success, normal reload/original-key retry, then cancellation of each undelivered five-unit remainder. Three explicit customer terms revisions: COD, Prepaid and restoration of original Net 7/PHP 5,000. No credit-limit increase. Maximum thirteen business mutation POSTs in a sixty-minute window, including four paid first/retry POSTs. Retained synthetic history: two paid invoices/receipts for PHP 1,600 total and Main P-00001 stock three to one. No real cash/delivery, replenishment, refund, fund allocation, new access/token/migration, API/POS/Admin/Production release or paid project.

Exact order/reference/catalog identifiers and original preflight are in `AW3_PAID_RECOVERY_HARDENING_2026-10-14.md`. Separate temporary exact-CI-verified Staging Back Office release and clean restoration are included in the approved scope. The new paid amount/authorized invoice-history correction is inherited from verified `40b919d`.

## Controlled Diagnostics

Opt-in `fresh-paid-v1` rejects non-Staging build endpoints or expiry beyond sixty minutes; runtime verifies exact origin/API/Auth/owner/tenant/window. Visible arming validates unique fresh draft, exact customer/Main/list/notes/quantities/prices, no prior invoice and expected shared stock. Arming writes diagnostic metadata only, never ordinary pending or Auth records.

Normal forms persist their own original pending command before any wrapped request. Each case allows one exact empty-body confirmation (two reserved lines/PHP 4,800), then one exact one-unit/Cash PHP 800 fulfillment and one original-key/body retry. Unknown confirmation outcomes stop; unknown first or retry fulfillment outcomes cannot issue another diagnostic request. Stored invoice response must be new, partial and exact; replay response identity must match. Four paid POSTs/two confirmation POSTs are bounded by case latches. The remaining seven approved setup/cleanup POSTs (three terms, two drafts, two cancellations) use ordinary forms under the operator's explicit counted scope; the wrapper is not a general network interceptor or server-side approval boundary.

Case closing requires resolved ordinary pending, matching authorized invoice history, exact cancelled five-unit remainder and expected shared-stock balance with zero reservations. Prepaid cannot be armed before COD is closed. Cleanup requires both closed cases and no ordinary/legacy pending, then a terminal diagnostic marker prevents rearming. Independent SQL is required between first commit and retry and after cancellation/terms restoration. Close the diagnostic tab after clean restoration to dispose its terminal session marker.

## Execution Sequence And Safety

1. Finish full local checks, normal bundle fixture exclusion, scoped freeze/secret scan/push and exact-candidate CI. No live setup writes before candidate verification.
2. Recheck full post-payment/fund baseline and original revision 7 Net 7/PHP 5,000, no target orders/references, exact pricing/shared stock and active feature window. Verify clean rollback version before temporary Staging release.
3. Start the fixed sixty-minute artifact window. Temporary Staging Back Office-only build/dry-run/deploy with public configuration; remove generated private vars, verify target/live asset hashes. Preserve existing private owner Auth without extraction.
4. Terms COD (POST 1), draft COD (2), arm only diagnostic metadata, confirm COD (3), first paid fulfill (4), independently reconcile, reload, original retry (5), exact remainder cancel (6), independently reconcile/close COD.
5. Terms Prepaid (7), draft Prepaid (8), arm, confirm (9), first paid fulfill (10), independently reconcile, reload, original retry (11), exact remainder cancel (12), independently reconcile/close Prepaid.
6. Restore original Net 7/PHP 5,000 (13), refusing concurrent settings drift. Independently verify original terms and final immutable financial/stock counts. Finish controls, restore clean Back Office version, verify live hashes/version/clean UI, close diagnostic session.

On any unknown outcome, expiry or drift: do not issue a fresh key, repeat a setup command, cancel unresolved fulfillment, replenish stock or delete history. Reconcile first and restore clean code; complete only independently safe cleanup within the approved scope/window. An unconfirmed draft is retained inert; cancellation applies only to confirmed/partially fulfilled orders. Report any residual state accurately.

## Verification

Nineteen new diagnostic regressions; four focused recovery files passed 129 tests. Full `npm run check` exited zero: 608 application tests/26 files, 47 Node harness tests, format/lint/typechecks/secret scan and all standard/Cloudflare builds. Dependency gate passed under existing build-only exceptions. Normal Next/vinext JavaScript excludes fresh paid fixtures/control labels. Exact CI pending. No live delivery, collection, settings change or deployment yet.

The successful payment/fund baseline remains: sales/orders/invoices 11/11/5, receipts/allocations 5/6, fund allocations/entries 2/4, debt zero, Capital PHP 1,500/Operating PHP 900, Main stock 3/4 and Branch 2 two, zero reserved/transit, 65 migrations, B suspended/tester inactive. Fresh paid final expectations: sales/orders/invoices 13/13/7, receipts/allocations 7/8, two new paid mappings, funds unchanged and debt zero, Main stock 1/4, Branch 2 two, all new reservations released, original customer terms restored. Preserve all prior immutable key/receipt/fund rows; verify unique invoice/receipt/stock/audit/outbox effects and exact actor-bound hashes rather than totals alone.

Next after a successful exact batch: reconcile Gate 4 coverage and proceed to final Gate 5 environment/security/restore/rollback review; AW3 Production release remains separately approved.
