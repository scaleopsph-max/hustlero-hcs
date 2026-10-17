# Staging Fresh Payment/Fund Recovery Candidate

Date: 2026-10-14. Status: local verification passed; isolated candidate CI and exact live execution approval pending. This is not a live test result or Production release approval.

## Purpose and Boundary

The completed historical browser batch reconstructed existing pending commands. This candidate instead lets the ordinary payment/fund forms generate and persist their own new command keys and bodies before the first HTTP request. The narrow owned-command wrapper withholds one validated successful response, preserving the original pending command for normal reload and same-key retry. It does not simulate a disconnected network or provider settlement.

Only the existing PABL0 owner on the exact Staging Back Office/API/Auth origins is eligible. The opt-in `fresh-payment-funds-v1` build expires within 60 minutes, permits only payment and fund routes, and caps each case at its first request plus one retry (four POSTs total). Unknown outcomes, conflicting identity, corrupt state and uncertain retries stop further diagnostic sends for independent reconciliation. Normal builds exclude the fixtures and controls. No Auth storage is read or modified. Arming writes a diagnostic marker only, never application pending storage; normal form persistence is a tested prerequisite.

This slice does not close fresh COD/Prepaid first-commit browser coverage. Historical paid recovery is separate verified evidence. Gate 4 completeness, final Gate 5 review and AW3 Production approval remain separate.

## Proposed Live Scope: Not Yet Approved

Temporary exact-CI-verified development-commit Staging Back Office release only, followed by restoration of clean version `4e0c190e-de59-4df9-a963-12cd0bcce887`. No API/POS/Admin/Production deployment, migration, new access, token or paid project.

1. Record one synthetic Cash receipt of PHP 1,600 against PABL0 invoice `INV-20261012-000001` (`6363f7d5-9205-4c4e-9c03-15c0a91de2a0`), customer `5a3fdf97-3259-42e4-a340-86f045998b35`, using existing Cash method `fc75965f-b614-4a78-a1c1-562a7aad21b5`. Reference: `AW3-FIRSTCOMMIT-PAYMENT-20261014-R1`. One exact invoice allocation of 160000 minor units.
2. Withhold its first successful new receipt response. Independently verify one completed key/receipt/allocation/audit/outbox and zero remaining invoice balance before reload and ordinary original-key retry. Verify identical response, no duplicate effects, authorized history and cleared ordinary pending slot.
3. Allocate only that newly returned receipt: PHP 1,000 Capital/COGS and PHP 600 Operating; synthetic settlement attestation; reference `AW3-FIRSTCOMMIT-FUNDS-20261014-R1`; reason `Owner-approved synthetic Staging first-commit recovery UAT; no real settlement or Production money`.
4. Withhold its first successful allocation response. Independently verify one allocation/two fund movements/audit/outbox before reload and ordinary original-key retry. Verify exact original response and no duplicates. Finish controls only when both recoveries and all ordinary pending slots are clear.
5. Restore the clean immutable Back Office version, verify active deployment/live asset hashes, close the diagnostic tab and reconcile all effects. On failure or expiry, restore clean code without deleting unresolved pending or append-only financial history; stop and report the actual committed state rather than issue a fresh key.

These are new append-only synthetic Staging financial records, not history-only replay. They remain as UAT evidence. No real cash or bank settlement is represented, and no compensating deletion is permitted.

## Baseline and Expected Deltas

Read-only preflight verified the exact invoice/customer/location, PHP 1,600 open balance and zero matching fresh receipt references. Recheck the full baseline immediately before any approved live execution; refuse drift.

| Metric | Baseline | Expected after approved batch |
| --- | ---: | ---: |
| PABL0 sales/orders/invoices | 11 / 11 / 5 | unchanged |
| Receipts / invoice receipt allocations | 4 / 5 | 5 / 6 |
| Classified receivable | PHP 1,600 | PHP 0 |
| Fund allocations / ledger entries | 1 / 2 | 2 / 4 |
| Capital / Operating | PHP 500 / PHP 300 | PHP 1,500 / PHP 900 |
| Idempotency / audit / outbox rows | 103 / 150 / 128 | 105 / 152 / 130 |
| Inventory movements | 21 | unchanged |
| Migrations | 65 | unchanged |

Main stock remains P-00001 three (version 21), P-00002 four (version 22); Branch 2 P-00002 two (version 2); reserved/in-transit zero. B remains suspended and the restricted tester inactive. Verify unique business audit/outbox records and exact key-bound request hashes, not only row totals.

## Executed Local Verification

- Twenty new fresh-mode regressions; 158 focused recovery tests across five files passed.
- Full `npm run check` exited zero: 568 application tests across 25 files, 47 Node harness tests, tracked-file secret scan, formatting, lint, typechecks, standard and Cloudflare builds.
- Dependency gate passed under the existing documented build-only exceptions; no claim of zero vulnerabilities.
- Normal Back Office `.next/static` and `dist` JavaScript scan returned zero fresh fixture references or diagnostic control labels.
- No fresh diagnostic live build, release, first financial request, new role grant, token, migration or Production change has executed.

Next: freeze only the scoped code and this plan, post-stage secret scan, development-branch commit/push and exact-SHA CI. Obtain explicit approval of the above persistent financial effects and bounded temporary Staging release before any live action.
