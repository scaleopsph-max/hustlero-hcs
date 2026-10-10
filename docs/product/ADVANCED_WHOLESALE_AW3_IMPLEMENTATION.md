# Advanced Wholesale AW3 Implementation

Date: 2026-10-10

Status: Domain foundation, opening/settings APIs, and credit enforcement verified in isolated CI. Dedicated override approval persistence is the next candidate. Payment allocation, override consumption, and UI remain incomplete. Staging/Production release has not occurred.

Source: `ADVANCED_WHOLESALE_BLUEPRINT.md`, ADR-038, ADR-039, ADR-041, and owner confirmations on 2026-10-10.

## Confirmed opening receivables

The owner explicitly selected unpaid opening receivables for the two existing Production invoices and confirmed the same cash payment method and due date, 2026-10-10, for both.

| Invoice | Original amount | Opening amount | Due date | Payment recorded |
| --- | --- | --- | --- | --- |
| INV-20261010-000001 | PHP 2,250.00 | PHP 2,250.00 | 2026-10-10 | None |
| INV-20261010-000002 | PHP 2,250.00 | PHP 2,250.00 | 2026-10-10 | None |

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

This candidate does not yet consume approvals or bypass the enforced limit. An explicitly tested approved record alone still leaves over-limit confirmation blocked. Order/action/customer matching, exact current excess validation, single-action consumption, expiry/revocation checks, and concurrent revocation versus execution must be wired atomically before release. Payments, UI, and Staging UAT remain separate incomplete work. Execution verification is pending; Production is unchanged.

## Next database and service slice

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

The migration was applied only to a disposable CI database. No Staging/Production migration, Production balance change, real payment posting, Worker deployment, or real opening-entry execution has occurred. AW4 return/credit-note/refund behavior remains unavailable. The two PHP 2,250.00 invoices remain unpaid and unchanged until the explicit opening command is released and executed after complete validation.
