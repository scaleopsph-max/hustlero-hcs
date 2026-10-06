# Production Basic Wholesale UAT

Date: 2026-10-05

Environment: Production

Tenant: `SAH RESTORATION`

Location / register: `Main Store / Main Register`

## Approved scope

The owner explicitly approved `CONFIRM PRODUCTION WHOLESALE PHP 4,500 AND DEALER PHP 19,950 CASH UAT WITH FULL REFUNDS`.

The controlled validation used the existing shared-inventory variant `SAH SOCKS V1 / WHITE` (`SAH-00001`) and generated reseller `Production Wholesale UAT Reseller` (`CUST-000001`). Wholesale and Dealer pricing consumed the same branch-variant stock balance used by Retail.

## Production configuration

- Wholesale price list: minimum 10 units, `PHP 450.00` per unit.
- Dealer price list: minimum 50 units, `PHP 399.00` per unit.
- Both lists are active, reseller-gated, server-priced, and scoped to the Production tenant.

## Wholesale validation

- With no reseller selected, Wholesale checkout remained blocked.
- At one unit, POS reported `Core products needs 10 units; cart has 1` and kept Charge disabled.
- At ten units, POS applied `PHP 450.00` per unit and calculated `PHP 4,500.00`.
- Exact-cash receipt `MAIN-20261005-000001` posted once.
- A full `PHP 4,500.00` refund was then recorded with all ten units returned to stock.
- The receipt is `refunded` and its reversal reason is `Production qualified wholesale UAT reversal`.

## Dealer validation

- At one unit, POS reported `Dealer core products needs 50 units; cart has 1` and kept Charge disabled.
- At fifty units, POS applied `PHP 399.00` per unit and calculated `PHP 19,950.00`.
- Exact-cash receipt `MAIN-20261005-000002` posted once.
- A full `PHP 19,950.00` refund was then recorded with all fifty units returned to stock.
- The receipt is `refunded` and its reversal reason is `Production qualified dealer UAT reversal`.

## Reconciliation

- Inventory returned to the pre-UAT baseline: on hand `95`, reserved `0`, available `95`, and in transit `0`.
- The movement ledger shows the Wholesale sale `-10`, Wholesale refund `+10`, Dealer sale `-50`, and Dealer refund `+50`, ending at balance `95`.
- The reseller profile shows `PHP 0.00` net spend, two retained visits, and zero loyalty points. Loyalty is disabled for this tenant, so no loyalty ledger entry was expected.
- The owner supplied the physical drawer count of `PHP 1,000.00` on 2026-10-06.
- The Main Register closed and reconciled with `PHP 1,000.00` expected cash, `PHP 1,000.00` counted cash, and `PHP 0.00` variance.
- No register session remains open.

## Result

Production Basic Wholesale and Dealer pricing passed the controlled quantity-threshold, reseller-gating, server-price, cash-sale, full-refund, shared-inventory, customer-balance, and zero-variance register-reconciliation checks. The two UAT receipts and their append-only reversals remain as Production audit evidence.
