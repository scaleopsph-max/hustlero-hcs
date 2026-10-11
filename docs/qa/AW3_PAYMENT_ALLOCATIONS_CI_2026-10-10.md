# AW3 Payment Allocation Verification

Date: 2026-10-10

## Verified Candidate

- Branch: `codex/advanced-wholesale-aw3`
- Commit: `6cda83c92488939d01397ad27bf9d35c5115189c`
- CI: [38063757985](https://github.com/scaleopsph-max/hustlero-hcs/actions/runs/38063757985)
- Migration: `20261010144125_advanced_wholesale_payment_allocations.sql`
- Both application and database jobs passed, including disposable-stack cleanup.

## Executed Checks

Local `npm run check` and CI application verification passed secret scanning, formatting, lint, typechecks, 224 unit tests, standard builds, and Cloudflare builds/dry run. CI also passed the dependency-security gate. Pre-push secret scanning passed across 385 tracked files.

The fresh disposable Supabase reset applied all ordered migrations. All 1,074 pgTAP assertions across 35 files passed, including 56 dedicated payment assertions. Local Docker remains unavailable; no live database was substituted.

The first CI run failed one changed-replay assertion because its SQL fixture supplied the same request hash for different amounts. The fixture now hashes the amount and allocation payload. No payment-command validation was relaxed.

Coverage includes strict exact allocations, partial and full settlement, legacy classification, permission and branch denial, inactive payment methods, entitlement checks, replay authorization, changed-content conflicts, atomic rollback, immutable ledgers, audit/outbox, and no fabricated POS tender, register movement, or fund allocation.

## Concurrency

All nine independent-session scenarios passed: three existing ordinary credit cases, four scoped override cases, and two new payment cases. Actual lock waits are observed before committing the winning transaction.

1. Identical concurrent multi-invoice payment retries return the same receipt and create one header with two allocations.
2. Two distinct payments competing for the remaining invoice balance cannot both succeed. The loser receives the controlled over-allocation conflict without another receipt. Final balances and credit exposure reach zero while inventory remains unchanged.

## Release Boundaries

- Feature-branch verification only; no merge, live migration, Worker deployment, or actual Production payment.
- Production's two retained PHP 2,250.00 invoices remain unpaid and unchanged.
- Manual payment recording is not an external charge or bank transfer.
- Receipt/history UI, settlement reports, user-confirmed fund allocation, paid prepaid/COD fulfillment, and full AW3 Staging UAT remain incomplete.
- Existing sales-by-payment reports are not claimed to include this new wholesale receipt ledger yet.
- Preserve immutable receipts and allocations during rollback; use reviewed corrective migrations and the recovery runbook rather than deleting financial history.
