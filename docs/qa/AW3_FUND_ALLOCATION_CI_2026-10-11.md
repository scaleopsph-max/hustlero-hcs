# AW3 Fund Allocation Verification

Date: 2026-10-11 (Asia/Manila)

## Verified Candidate

- Branch: `codex/advanced-wholesale-aw3`
- Commit: `317244d30502075298064642bc2a489d9039194b`
- CI: [38108366556](https://github.com/scaleopsph-max/hustlero-hcs/actions/runs/38108366556)
- Migration: `20261011031029_advanced_wholesale_fund_allocation.sql`
- API: GET/POST `/v1/wholesale/funds`
- Back Office: `/wholesale/funds`, linked from Payments

## Executed Verification

Local `npm run check` passed the initial candidate with 289 unit tests, formatting, lint, typechecks, standard builds, and Cloudflare builds/dry runs. Final CI verified the rejection-handling follow-up with all 297 unit tests across 14 files, dependency security, tracked-file secret scanning across 406 files, full formatting/lint/type/build checks, a fresh disposable Supabase reset, all 1,136 pgTAP assertions across 35 files, eleven actual independent-session scenarios, and stack cleanup.

The payment/report/fund SQL suite contains 118 assertions, with 29 added for funds: authorization, missing setup rollback, exact split validation, unsettled confirmation denial, negative share rejection, immutable confirmation and ledger, one-time replay, changed request rejection, duplicate receipt denial, balances/history, no receipt/revenue/register changes, audit/outbox deduplication, browser revokes, other-tenant/foreign actor isolation, and zero-share omission.

Two additional concurrency scenarios verify simultaneous identical allocation retries post once, and competing distinct commands cannot post two allocations for one receipt. Both share the same physical receipt lock and preserve the original fund totals. Existing nine credit/override/payment races also passed.

API/contract regressions cover server-derived scope, unauthorized tenant rejection, sanitized SQL errors, explicit settlement confirmation, negative/fractional/unsafe/zero total inputs, payload scope rejection, and zero-share acceptance. Retry-state regressions distinguish definitive allocation denial from uncertain and permission outcomes.

## Synthetic Browser Checks

Playwright exercised the local Next server with intercepted synthetic session/API fixtures; no live credential or command was used.

- Incorrect receipt splits were rejected before any API command.
- Unknown response followed by reload/retry preserved identical key and payload.
- Successful allocation showed exact fund balances and history.
- Duplicate-allocation rejection unlocked editing instead of trapping a stale retry.
- Read-only management authority disabled submission.
- Desktop 1440x1000 and mobile 390x844 screenshots were inspected; no document overflow or page errors. History scrolls inside its table container on mobile.
- Synthetic screenshots are untracked in `output/aw3-funds/desktop.png` and `mobile.png`.

## Boundaries

This first slice manually allocates one fully settled receipt into the two basic funds exactly once. The operator attests actual settlement with a reference/reason; it is not automated bank/provider proof. There is no automatic ratio, COGS recommendation, non-cash settlement inference, real bank transfer, historical backfill, new payment, invoice revenue, customer debt, or inventory change.

Partial settlement/allocation, compensating fund correction/reversal UI, prepaid/COD paid fulfillment, statements/aging, full Staging UAT, and a separate Production release remain outstanding. Roll back application traffic without deleting immutable allocations or fund movements. No merge, live migration, Worker deployment, or Production financial command occurred.

The local screen is available at `http://localhost:3001/wholesale/funds`; real-data use requires the unreleased AW3 API and migration. Browser verification used fixtures rather than claiming a live deployment.
