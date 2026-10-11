# Advanced Wholesale AW3 Implementation

Date: 2026-10-10

Status: Domain foundation, opening/settings APIs, credit enforcement, scoped overrides, manual payment allocation/history, and settlement reporting verified in isolated CI. User-confirmed fund allocation is the current candidate. Complete AW3 Staging/Production release has not occurred.

Source: `ADVANCED_WHOLESALE_BLUEPRINT.md`, ADR-038, ADR-039, ADR-041, and owner confirmations on 2026-10-10.

## Confirmed opening receivables

The owner explicitly selected unpaid opening receivables for the two existing Production invoices and confirmed the same cash payment method and due date, 2026-10-10, for both.

| Invoice             | Original amount | Opening amount | Due date   | Payment recorded |
| ------------------- | --------------- | -------------- | ---------- | ---------------- |
| INV-20261010-000001 | PHP 2,250.00    | PHP 2,250.00   | 2026-10-10 | None             |
| INV-20261010-000002 | PHP 2,250.00    | PHP 2,250.00   | 2026-10-10 | None             |

This is authority for an explicit, audited opening command after release verification, not evidence that the command has run. Cash identifies the intended payment method, not proof of payment or a new default customer payment term. Do not infer `cod`, a credit limit, or a new customer agreement from it.

The opening command must reference the existing immutable invoice and derive its amount, currency, customer, tenant, and location on the server. It must neither recreate revenue nor post stock movements. A unique tenant/invoice charge prevents a second opening entry or a normal invoice charge plus opening charge for the same invoice. No blanket historical backfill is authorized for other tenants or invoices. Historical invoices without explicit classification must remain visibly unclassified, never silently treated as paid or automatically overdue.

## Local foundation delivered

- Strict settings, opening-receivable, and payment-allocation request schemas reject client tenant IDs, opening amounts, and invoice balance projections.
- Monetary inputs and aggregated exposure use safe integer minor units, with BigInt intermediate arithmetic and fail-closed overflow checks.
- Due dates derive from an offset-aware issue timestamp in the branch timezone, adding calendar days rather than local daylight-saving hours.
- Due today remains current; overdue starts on the next branch business date. Aging bands are current, 1-30, 31-60, 61-90, and over 90 days.
- Credit exposure equals open receivables plus confirmed unfulfilled exposure; zero limit means no credit. Available credit can be negative for honest reporting of existing over-limit debt.
- Prepaid/COD fulfillment requires exact full payment. Net terms allow an unpaid or partially paid invoice, subject to server-side credit enforcement.
- Payments require unique invoice allocations totaling the payment exactly. Each allocation must fit the server-derived locked open balance. Customer-credit handling is not implicitly enabled.

These are framework-independent rules and request contracts, not authorization controls. The foundation step alone added no endpoint. The subsequent opening candidate below adds its own authorized routes; existing AW2 confirm/fulfill commands still do not call the credit/payment helpers.

## Opening database/API candidate

Migration `20261010111813_advanced_wholesale_opening_receivables.sql` registers existing invoices as eligible legacy records without posting any debt. New invoices created after that migration are not eligible for this historical-opening command. The registry and charge ledger use composite tenant references, RLS, no direct browser/Hyperdrive DML, and immutable update/delete triggers.

`POST /v1/wholesale/receivables/opening` accepts only invoice ID, explicit due date, and reason with an Idempotency-Key. The API resolves the authenticated actor and accessible tenant. The database rechecks active entitlement and active owner membership, derives amount/customer from the original invoice, serializes command-key retries and invoice classification, and atomically records the charge, audit event, outbox event, and replay response. A fresh key cannot classify an invoice twice. Original invoice, sale, stock, and cash ledgers are untouched.

`GET /v1/wholesale/receivables` exposes tenant-authorized invoice classification and opening balances. Unclassified invoices retain null balance and due date; null must never be rendered as paid/zero debt. Opening classification is owner-only; read access follows the existing wholesale read permission. This read model does not yet account for payments, so no payment-posting route is exposed in this slice.

The database tests cover RLS/grants, tenant denial, owner and entitlement checks, server-derived amount, idempotent replay, changed-hash conflict, duplicate classification, immutability, single audit/outbox events, and no revenue/payment/inventory side effects. These pgTAP assertions passed in disposable CI, not on the local Windows machine.

## Customer credit-settings candidate

Migration `20261010123904_advanced_wholesale_customer_credit_settings.sql` stores immutable, tenant-scoped customer settings revisions: explicit prepaid/COD/net terms, exact numeric credit limit, actor, reason, and timestamp. No default agreement is inferred for unconfigured customers. A zero credit limit remains zero, not unlimited. Settings changes do not create debt, move stock, or modify existing invoices.

Authorized GET/POST `/v1/wholesale/credit-settings` routes resolve actor and tenant on the server. Writes require active entitlement and membership, wholesale read access, and ownership or explicit `wholesale_orders.manage` permission. Customer eligibility and permissions are rechecked on retries. Commands lock the customer row, serialize revision numbers, and atomically persist history, audit, outbox, and replay response. The latest revision is selected by ordinal, not timestamp. Tables use RLS, browser/direct Hyperdrive revokes, and narrow function execute grants.

This is persistence and API only. Existing AW2 confirmation/fulfillment commands do not yet enforce these settings; immutable commercial snapshots, credit exposure enforcement, approvals, payment persistence, UI, and concurrency verification follow separately. Local `npm run check` passed with 180 tests. Isolated CI run `38054006849` verified commit `76b4f188c8dc6507508e9b1c797b1d8c753ab1ce`, including fresh migration reset and 913 pgTAP assertions across 33 files (32 new settings checks). Evidence and remaining verification boundaries are in `../qa/AW3_CREDIT_SETTINGS_CI_2026-10-10.md`.

## Credit-enforcement candidate

Migration `20261010133336_advanced_wholesale_credit_enforcement.sql` wraps the existing tested inventory commands with server-side credit controls. The inventory cores lose all browser/Hyperdrive execute grants; callers cannot bypass the wrappers. Order and customer locks precede inventory locks. Settings writes and explicit opening classification share the customer credit-scope lock.

Confirmation refreshes prices using the existing inventory core, checks the resulting whole-customer exposure, then records an immutable settings/term snapshot. Any failure rolls back the complete command, including reservations, idempotency, audit, and outbox. Customers without explicit settings cannot proceed. No historical confirmed-order agreement is invented on replay.

Net-term fulfillment retains the confirmed term while rechecking the latest credit limit. It issues the existing immutable invoice and appends a linked invoice charge with a branch-timezone business date plus calendar-day term. Exposure includes opening debt, issued invoice debt, and remaining confirmed/partially fulfilled line value. Released fulfilled commitment is not counted twice. Unknown historical invoice balances block credit use instead of becoming zero debt. The receivables context distinguishes `invoice`, `opening`, and `unclassified` records.

The current signature has no payment command, so prepaid/COD fulfillment fails closed and never claims cash was received. No unchecked approval bypass exists: dedicated approved overrides and payment/settlement integration remain separate incomplete slices. Application errors expose controlled 409 messages, not private database details.

Regression coverage includes missing/zero/insufficient/exact credit, rollback side effects, limit reduction after confirmation, immutable terms/debt, due dates, partial fulfillment, replay, history classification, and COD payment denial. CI includes a fixed-loopback-only disposable database script for competing confirmations, settings reduction versus fulfillment, and simultaneous fulfillment replay. Local checks passed with 184 unit tests. CI run `38057004425` verified commit `04778d2a84ae9da20e0e35b74d5079dcf5f8ad91`: both jobs passed, including fresh reset, 945 pgTAP assertions across 33 files, and all three multi-session scenarios. The initial race-fixture contact omission was corrected without weakening schema constraints. Evidence and remaining verification boundaries are in `../qa/AW3_CREDIT_ENFORCEMENT_CI_2026-10-10.md`. No live migration, settings change, or Production balance change occurred.

## Dedicated credit-override approval candidate

Migration `20261010135722_advanced_wholesale_credit_override_approvals.sql` adds immutable order/action-specific approvals and separate append-only revocations. The database derives the customer from the tenant-authorized order, records the approver, reason, exact approved excess, and future expiry, and atomically writes audit/outbox/idempotency. No existing inventory approval payload is reused.

Writes require active Advanced Wholesale entitlement, active membership, wholesale-management access, and ownership or explicit `approvals.manage` permission. Approval reads use wholesale read access. Confirmation approvals require a draft order; fulfillment approvals require a confirmed or partially fulfilled order. A manager without approval permission cannot authorize an exception. Revocation retains the approval and appends actor/reason/time; repeated identical commands replay without duplicate events. No new self-approval restriction is invented beyond the existing permission model.

API routes are GET/POST `/v1/wholesale/credit-overrides` and POST `/v1/wholesale/credit-overrides/:id/revoke`. Runtime schemas reject client tenant/customer/approver IDs, nonpositive or fractional amounts, and missing offset-aware expiry. SQL validates expiry against wall-clock time again after obtaining scope locks. Replay denotes the original command result, not current validity; future consumption must independently recheck expiry and revocation.

This candidate does not yet consume approvals or bypass the enforced limit. An explicitly tested approved record alone still leaves over-limit confirmation blocked. Order/action/customer matching, exact current excess validation, single-action consumption, expiry/revocation checks, and concurrent revocation versus execution must be wired atomically before release. Payments, UI, and Staging UAT remain separate incomplete work. Local checks passed; isolated CI `38058245765` verified commit `23197715855568f202610552e2e760a40b93b849` with 200 unit tests, fresh reset, 973 pgTAP assertions across 33 files, and three existing credit-enforcement concurrency scenarios. Approval-consumption/revocation races remain untested until consumption is implemented. Evidence: `../qa/AW3_CREDIT_OVERRIDE_APPROVALS_CI_2026-10-10.md`. Production is unchanged.

## Atomic override consumption candidate

Migration `20261010142545` adds an append-only consumption ledger and narrow confirmation/fulfillment commands requiring an explicit approval ID. Existing no-override commands still enforce the normal limit. Strict API inputs accept only the optional `creditOverrideId`; the selected approval participates in request hashing. The database resolves customer/tenant/actor and holds order/customer locks shared with approval/revocation commands.

Commands calculate exact whole-customer exposure after current-price confirmation or replacement of fulfilled commitment with invoice debt. Approval must match the order, customer, and action, be unrevoked and unexpired at wall-clock execution time, not previously consumed, and cover the positive current excess. Unneeded approvals are rejected instead of consumed. The actual excess, current limit, exposure, actor, action, and command identity are immutable audit/outbox-backed truth. Confirmation and each partial fulfillment require separate approvals when over limit. Prepaid/COD still require genuine payment and cannot bypass that requirement using credit approval.

Identical completed commands replay the original outcome without requiring the historical approval to remain unexpired or unrevoked; immutable consumption must match the selected approval, order/action, key, and hash. Revocation after committed consumption preserves history and does not reverse a completed business command. New use of revoked or consumed approval is denied. Atomic rollback preserves stock, reservations, invoices, debt, and approval availability on failed commands.

Unit tests and SQL regressions cover strict inputs, explicit selection, retry binding, exact excess, insufficient scope, wrong action, replay, reuse denial, and rollback. Multi-session cases add revocation-first, simultaneous override confirmation retries, expiry after lock wait, and consumption-first followed by revocation and replay. Local `npm run check` passed with 208 unit tests, formatting, lint, typechecks, standard/Cloudflare builds, and secret scanning. CI `38060191768` verified commit `5f73b2803f240d9f570ca3f083b7e94ab1ab78c9` with fresh migration reset, 1,018 pgTAP assertions across 34 files, and all seven multi-session cases. Evidence: `../qa/AW3_CREDIT_OVERRIDE_CONSUMPTION_CI_2026-10-10.md`. No live changes occurred. Approval history UI/read-status integration, payments/allocation/settlement, and Staging UAT remain required.

## Payment/allocation backend candidate

Migration `20261010144125` and POST `/v1/wholesale/payments` implement manually received payment recording and exact explicit invoice allocations. Header/allocation ledgers are append-only, tenant-referenced, RLS-enabled, directly inaccessible to browser/Hyperdrive roles, and exposed only through an authorized atomic command. Inputs cannot supply tenant/actor, balance projections, or a backdated receipt timestamp. Allocation sum must equal receipt amount; duplicate invoices, fractional minor units, unclassified invoices, wrong customer/tenant/method/branch, and overpayments are rejected.

The command requires wholesale read plus ownership or explicit `wholesale_payments.record`; nonowners must have an active employee assignment at every invoice location. No cashier or manager automatically receives payment-recording authority. Active entitlement, membership, customer eligibility, and branch access are rechecked on historical retries. Payment-method availability is required for new receipts, not to replay the original completed payment. Customer locking shares credit scope with existing commands; invoice locks use UUID order. Errors roll back the receipt, all allocations, audit, outbox, and replay record together.

Derived invoice balances and credit exposure now subtract successful allocations. Original invoices, revenue, inventory, and due dates are unchanged. This payment ledger is manual settlement truth only: it does not charge a bank/provider, fabricate POS tender/register activity, or split money into business funds. PROJECT_SPEC section 18.4 requires user-confirmed fund allocation, so Finance/fund projection, payment-period reports, receipt/history UI, and paid prepaid/COD fulfillment remain separate incomplete integration work. Existing sales-by-payment reporting is not claimed to include these receipts yet.

Execution verification passed in isolated CI `38063757985` for commit `6cda83c92488939d01397ad27bf9d35c5115189c`: 224 unit tests, fresh reset, 1,074 pgTAP assertions across 35 files (56 dedicated payment assertions), nine actual multi-session scenarios, and full application/security/build checks. The two new payment scenarios verify simultaneous multi-invoice replay and competing distinct payments against the same remaining balance. Initial changed-replay failure was a fixture hash mistake, corrected to reflect payload changes. Evidence: `../qa/AW3_PAYMENT_ALLOCATIONS_CI_2026-10-10.md`. No live environment or Production balances changed.

## Next database and service slice

### Manual receipt settlement-report candidate (2026-10-11)

GET `/v1/reports/wholesale-settlement` and Back Office `/wholesale/settlement` report Advanced Wholesale invoices and manually recorded receipt allocations only. Existing POS tender reports stay unchanged. Issued revenue and received money are distinct metrics; opening charges never create another sale. Payment-method sums count allocations once and distinct receipts once. A location filter includes only the payment portions allocated to that location's invoices.

Period receipts use receipt `recorded_at`; issued invoices use `issued_at`. Classified closing receivables span every invoice before the exclusive cutoff, minus allocations recorded before that cutoff, and require a charge recorded before it. Unknown classification is reported separately rather than silently becoming a complete zero balance. The existing tenant-reporting timezone defines local midnight; the cutoff is capped at the generation statement time for unfinished/future periods. This report is not a provider settlement confirmation or bank reconciliation.

The reader requires owner access or both wholesale-order-read and reports-read permissions, with current membership/entitlement and tenant-scoped location validation. CSV labels are escaped against spreadsheet formula execution. Fund allocation remains user-confirmed and limited to actually settled money (PROJECT_SPEC 18.4 and finance rules); no fund entries, bank transfers, or inferred non-cash settlement are created by this report.

CI `38105206293` verified commit `839c183c94ff607f103544936778a03f2c3bb111`: both jobs passed full application verification with 274 unit tests, fresh migration reset, 1,107 pgTAP assertions across 35 files, nine independent-session scenarios, and cleanup. Synthetic browser checks passed separate invoice/receipt/closing values, classification warnings, exact CSV export, date/location filters, stale-report removal after failed refresh, desktop/mobile overflow, and page errors. Evidence: `../qa/AW3_SETTLEMENT_REPORT_CI_2026-10-11.md`. No live migration, deployment, financial command, or fund entry occurred.

### Receipt history and payment screen candidate (2026-10-11)

Migration `20261011013731` adds a private authorized payment-context reader, exposed through GET `/v1/wholesale/payments`. Receipt amounts, allocations, references, and timestamps come from immutable ledgers; customer/payment-method display names are current labels, not newly introduced legal receipt snapshots. Wholesale readers can view tenant history consistently with the existing receivables reader. Recording permission is separate, and per-invoice branch eligibility comes from the same server check as the write command.

Back Office `/wholesale/payments` supports customer filtering, exact money entry, explicit invoice allocation, read-only access, and expandable receipt history. Unclassified invoices cannot accept allocations. Pending submissions preserve key/payload through reload in tenant-and-account-scoped session storage; known rejected commands unlock editing, while uncertain outcomes retain the same retry command. Client calculations do not replace database authorization or balance checks. This is not settlement/report integration or complete AW3 release.

Synthetic desktop/mobile browser checks passed entry, uncertain response followed by reload/retry with identical request identity, receipt expansion, definitive rejection unlocking, read-only recording controls, no page errors, and no document horizontal overflow. No real account or live payment was used. CI `38102962836` verified commit `fc82f7f7112b0ad745b93d1b9a2faf8644dcef94`: full application verification with 255 tests, fresh database reset, 1,085 pgTAP assertions across 35 files, nine independent-session scenarios, and cleanup passed. Evidence: `../qa/AW3_PAYMENT_HISTORY_UI_CI_2026-10-11.md`. Authorization/scope failures retain the pending retry because they do not prove a receipt was never posted. Settlement, complete Staging UAT, and live deployment remain separate work.

1. Add tenant-scoped customer credit configuration and immutable confirmation/fulfillment term snapshots. Resolve configuration on the server; do not apply later settings changes retroactively to confirmed commercial snapshots.
2. Add append-only invoice charges, payments, and allocations. Preserve original invoices. Use composite tenant foreign keys, RLS, explicit revokes, narrow authorized command functions, idempotency, audit, and outbox records.
3. Lock customer credit scope and affected invoices in deterministic order for confirm, fulfill, opening, and payment commands. Validate current entitlement, membership, location, customer eligibility, terms, exposure, and balances within that same transaction. TypeScript helpers alone cannot protect concurrent commands.
4. During partial fulfillment, replace only the fulfilled commitment with invoice debt. Do not count the invoice and its fulfilled reservation twice. Cancellation releases only remaining commitment. Payment reduces receivables without changing revenue or inventory.
5. Add a dedicated credit-override approval with actor, reason, approved excess amount, expiry, and explicit scope. The current inventory-specific approval payload must not be repurposed without a compatible domain schema. Never use an unchecked browser bypass flag.
6. Add explicit legacy opening classification, deriving the original invoice amount without an extra sale. Reject previously charged invoices, foreign-tenant invoices, and retries with changed content.
7. Define wholesale payment settlement integration with the existing payment/fund ledgers. Never invent a POS register session or claim a payment was received merely because its method is cash. No external payment gateway or bank charge is part of this manual-payment slice.
8. Add authorized context/settings/opening/payment API routes with server-resolved tenant context and exact runtime validation. Read models expose classified/unclassified status, balances, due dates, credit exposure, and aging as of the branch business date.
9. Build Back Office settings, invoice allocation, statements, aging filters, and CSV exports using existing visual conventions. Clearly distinguish issued revenue, cash receipts, debt, and legacy classification.
10. Run database reset/migration tests, tenant-isolation and role-denial tests, concurrent confirm/fulfill/payment tests, replay tests, ledger immutability tests, full repository checks, and Staging UAT before a separate Production release.

## Verification on 2026-10-10

- The 51 new domain/contract cases passed; the full Vitest run passed all 151 cases across nine files.
- `npm run check` completed successfully: tracked-file secret scan, formatting, lint, workspace typechecks, all unit tests, standard builds, and Cloudflare builds/dry run.
- Build output retained vinext dynamic-import/classification warnings; these were non-fatal and are not a browser-workflow verification.
- No SQL was added or executed in this slice. Migration, database concurrency, tenant-isolation integration, browser workflow, and Staging UAT checks remain required when the commands are implemented.

### Opening candidate follow-up verification

- The opening API tests passed; the latest full Vitest run passed 166 cases across ten files.
- `npm run check` completed successfully with 165 tests, tracked-file secret scanning, formatting, lint, typechecks, standard builds, API dry run, and Cloudflare builds. A subsequent classification-contract regression brought the latest unit run to 166 passing cases. Database verification remains separate.
- `npx supabase test db --local` was executed and failed to connect to `127.0.0.1:54322`. Docker is unavailable on PATH and absent from the standard Windows Docker installation path. No remote database was substituted.
- Subsequent isolated CI run `38052333432` verified commit `7ccae44c14da03ba0e6d972c5eece92a11a95234`: both jobs passed, including 166 Vitest cases, fresh Supabase reset, and 881 pgTAP assertions across 32 files. The opening suite contributed 31 passing assertions. Evidence is in `../qa/AW3_OPENING_RECEIVABLES_CI_2026-10-10.md`. Actual multi-session command concurrency and complete AW3 release validation remain required.

### Opening release and rollback constraints

Before release, compare the pre-migration invoice count against the registered legacy count, verify zero automatic charge rows, and verify exact migration version, RLS, revokes, and narrow execute grants. Do not post the owner-confirmed Production opening amounts during migration installation; they require separate explicit command execution after Staging validation.

Roll back API traffic to the previous immutable Worker version if necessary while leaving the additive schema and immutable charges intact. Never delete recorded debt to undo an application release. Database restore or a reviewed corrective migration follows the existing recovery runbook. This slice has no automatic down migration that destroys receivable truth.

## Release boundaries

### User-confirmed wholesale funds candidate (2026-10-11)

Migration `20261011031029` adds immutable `wholesale_fund_allocations` and authorized GET/POST `/v1/wholesale/funds`. Back Office `/wholesale/funds` is linked from Payments. The authorized user explicitly confirms the receipt is fully settled, provides a settlement reference/reason, and chooses exact Capital/COGS and Operating amounts. No percentage, COGS-derived recommendation, or automatic provider settlement is inferred. This first slice allocates a whole receipt once; a zero share creates no zero-value movement. Partial settlement/allocation and correction/reversal UI remain later work.

The command derives receipt amount, accounts, tenant, actor, and time on the server. Wholesale access plus active ownership or `funds.manage` is required; reads require ownership or `funds.read`. Receipt locking, unique receipt classification, account locks, actor-bound request hashes, and idempotency prevent double-posting. Ledger entries, settlement attestation, audit, outbox, and replay record commit atomically. Current access is rechecked after lock waits. Fund balances are ledger-derived. No invoice revenue, inventory, customer debt, POS cash movement, payment receipt, or real bank transfer changes.

The settlement confirmation is an operator attestation, not bank/provider proof. Non-cash money must be actually settled before the operator confirms it; selecting a payment method does not establish settlement. Existing receipts are not automatically allocated or backfilled. Pending browser commands preserve payload/key in user-and-tenant-scoped session storage through unknown outcomes and reload. Definitive validation/missing-receipt/missing-funds rejection releases editing; scope/authorization/unknown results retain retry identity.

Local unit verification passed 289 cases. Synthetic browser checks passed exact split rejection, uncertain response/reload/retry identity, fund balances/history, read-only controls, and desktop/mobile overflow/page errors. Full database/CI verification is pending. Complete Staging UAT remains required before a separate Production release.

The migration was applied only to a disposable CI database. No Staging/Production migration, Production balance change, real payment posting, Worker deployment, or real opening-entry execution has occurred. AW4 return/credit-note/refund behavior remains unavailable. The two PHP 2,250.00 invoices remain unpaid and unchanged until the explicit opening command is released and executed after complete validation.
