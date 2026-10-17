# AW3 Customer Statements and Aging Verification

Date: 2026-10-11 (Asia/Manila)

## Candidate

- Branch: `codex/advanced-wholesale-aw3`
- Commit: `5996dae294d33d18b8c3772a4edd573b81dfbd02`
- CI: [38114238892](https://github.com/scaleopsph-max/hustlero-hcs/actions/runs/38114238892), both jobs passed, including cleanup.
- Migration: `20261011050534_advanced_wholesale_statements_aging.sql`
- API: GET `/v1/wholesale/statements`
- Back Office: `/wholesale/statements`, linked from Orders.

## Local Verification

`npm run check` passed all 357 unit cases across eighteen files, formatting, lint, workspace typechecks, standard builds, API dry run, and Cloudflare builds. Post-staging secret scanning passed across 424 tracked files; staged diff whitespace verification passed. Existing vinext dynamic-import and route-classification warnings remain non-fatal. No live deployment command was executed.

The 27 new cases cover authenticated actor/tenant forwarding, foreign tenant selection, strict date/customer/location filters, sanitized database denials, exact ledger/invoice/aging reconciliation, unknown classification, unsafe money, each aging-band boundary, and formula-safe exact CSV export. Database execution is a separate gate.

## Synthetic Browser Verification

Playwright intercepted all API/Auth requests with synthetic fixtures. No live credential, invoice, charge, receipt, or inventory command was used.

- Invoice charge PHP 150.00 minus allocation PHP 50.00 displays PHP 100.00 classified balance.
- Unknown invoice PHP 2,250.00 remains explicitly unclassified with null due/balance and incomplete-balance warning.
- Customer/location filters are forwarded and the returned snapshot scope is displayed/exported.
- CSV retains exact decimal amounts and unknown values; formula-like invoice/reference text is apostrophe-prefixed.
- Failed refresh clears previous rows and disables export; a successful retry recovers the current snapshot.
- Only read-only GET requests are sent.
- Desktop 1440x1100 and mobile 390x844 screenshots were inspected; no document horizontal overflow or browser page errors. Tables scroll inside their own containers on mobile.
- Synthetic screenshots remain untracked under `output/aw3-statements/`.

## Database Gate

The disposable stack started successfully, applied a fresh database reset, and passed all 1,204 pgTAP assertions across 35 files. Twenty-three statement assertions were added to the existing payment fixture: unknown invoices remain null, exact balances after partial/multi-invoice payments, 31-day aging, future-due current debt, ledger reconciliation, full settlement, historical cutoff/midnight, invalid future/null dates, foreign scope/actor denial, empty branch filtering, and narrow execute grants. Thirteen existing independent-session scenarios passed across credit, overrides, payments, fund allocation, and prepaid fulfillment. Stack cleanup succeeded. Application CI independently passed all security/check/build steps. No extra live database was used.

## Release Limits

No Staging/Production AW3 migrations, historical opening commands, payments, bank confirmations, fund postings, or Workers releases occurred. Remaining settings/opening/approval command screens, cross-command races, complete Staging UAT, and separate Production approval are release gates. This candidate does not implement printable PDF statements, AW4 returns/credit notes, or Online Store.
