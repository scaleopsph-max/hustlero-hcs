# Production Guided POS UAT

Date: 2026-10-03  
Tenant: `SAH RESTORATION`  
Environment: Production controlled bootstrap

## Scope

Validate the first Production cashier session, register opening, single-item cash sale, inventory decrement, payment and cash accounting, and immutable integration evidence. This is controlled UAT data and does not authorize general live operations.

## Result

| Check | Verified result |
| --- | --- |
| Cashier | Active `EMP-001` session; credential unlocked |
| Register | Main Register opened with PHP 1,000.00 |
| Product | `SAH SOCKS V1 / WHITE` (`SAH-00001`) |
| Receipt | `MAIN-20261003-000001` |
| Sale | 1 unit at PHP 499.00 |
| Tender | PHP 500.00 cash |
| Change | PHP 1.00 |
| Inventory | Main Store on hand `100 -> 99`; reserved 0; average cost PHP 250.00 |
| Register cash | PHP 1,000.00 opening + PHP 499.00 sale = PHP 1,499.00 expected |

The sale, sale line, completed cash payment, `SALE` inventory movement, `cash_sale` cash movement, `sale.completed` audit event, and `sale.completed` outbox event each exist exactly once. The register opening likewise has one opening-cash movement, one audit event, and one outbox event.

## Remaining gate

Validate the receipt and report surfaces, execute an owner-confirmed same-session full refund, verify stock and cash reversals, close and reconcile the register, then complete rollback validation and final go-live approval.

No raw PIN, activation code, device token, access token, or database credential is included in this evidence.
