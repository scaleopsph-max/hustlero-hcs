# Staging Guided POS UAT - 2026-10-01

## Scope

Controlled end-to-end validation against the isolated `HUSTLERO HCS Staging` environment and generated `PABL0` tenant. No production resource, customer data, raw PIN, activation code, device token, or session token was used as report evidence.

## Fixture

- Location: `Main Store (MAIN)`
- Register: `Main Register (REG-001)`
- POS device: `Front counter POS`
- Employee: `PABL0 Cashier (EMP-001)`
- Product: `P SHIRT`
- Variant: `SMALL/BLACK`
- SKU: `P-00001`
- Opening stock: 10 units at PHP 499.00 average unit cost
- Retail price: PHP 999.00
- Register opening cash: PHP 1,000.00

## Transaction

- Receipt: `MAIN-20261001-000001`
- Quantity: 1
- Sale total: PHP 999.00
- Cash tendered: PHP 1,000.00
- Change: PHP 1.00
- Closing expected cash: PHP 1,999.00
- Closing counted cash: PHP 1,999.00
- Closing variance: PHP 0.00

## Results

| Check | Result |
| --- | --- |
| Device activation | Passed: device became active; one-time code hash and expiry were cleared; only a valid device-token hash remains |
| Activation audit | Passed: exactly one `pos_device.activated` event |
| Cashier authentication | Passed: active unexpired employee session, zero failed PIN attempts, unlocked credential, one session-start audit event |
| Register opening | Passed: one open session, PHP 1,000.00 opening cash, one matching cash movement and audit event |
| Catalog and availability | Passed: both generated variants rendered with 10 units available before sale |
| Checkout | Passed: one `P-00001` completed for PHP 999.00 with PHP 1.00 change |
| Receipt | Passed: official immutable receipt rendered in Back Office with the correct item, cashier, branch, register, and payment |
| Inventory | Passed: one `SALE` movement and `P-00001` decreased from 10 to 9 units |
| Cash ledger | Passed: one PHP 999.00 `cash_sale` movement |
| Audit and outbox | Passed: exactly one `sale.completed` audit event and one outbox event |
| Sales reporting | Passed: one transaction, PHP 999.00 net sales, PHP 499.00 COGS, PHP 500.00 gross profit |
| Inventory reporting | Passed: 19 total units on hand and PHP 9,481.00 valuation after sale |
| Register close | Passed: PHP 1,999.00 expected and counted, zero variance, no variance movement |
| Close audit and outbox | Passed: exactly one `register.closed` audit event and one outbox event |
| Shift reporting | Passed: one closed session, zero open, zero exceptions, one transaction, PHP 999.00 net sales, zero variance |
| Secret scan | Passed: no tracked credential was introduced |

## Resolved Follow-up

The Back Office sidebar previously displayed `PABL0 / 0 locations` because it used the owner's employee-assignment scope instead of the tenant's active-location total. The session contract and repository now expose an independently derived `locationCount`, with regression coverage for owner accounts that have no linked employee record. API Worker `1f099099-8a16-4203-9b7d-610e99c9885a` and Back Office Worker `e61b47e8-a317-4281-bfc8-fdc7402d6781` were deployed to Staging. Authenticated browser validation confirmed `PABL0 / 1 location` in both the selector and expanded menu, while Main Store and Main Register remained present on the Locations page.

## Conclusion

The guided Staging POS path passed from device activation through cashier sign-in, register opening, sale completion, immutable ledger posting, reporting, and balanced register close. The evidence confirms that the generated transaction remained tenant- and branch-scoped and reconciled across the operational projections and append-only records checked above.

Same-session full cash refund validation subsequently passed and is recorded in `docs/qa/STAGING_REFUND_UAT_2026-10-01.md`.

This report does not sign off the complete pilot. Broader module UAT, backup restore, Worker rollback, and final owner release approval remain separate gates.
