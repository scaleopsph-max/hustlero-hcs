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

## Refund and close result

The owner-confirmed same-session full refund completed for the receipt with return-to-stock enabled. The receipt status became `refunded`, stock returned `99 -> 100`, register cash returned `PHP 1,499.00 -> PHP 1,000.00`, and the refund, payment reversal, `REFUND` inventory movement, `cash_refund` cash movement, `sale.refunded` audit event, and `sale.refunded` outbox event each exist exactly once.

The owner-confirmed register close completed with PHP 1,000.00 expected and counted cash. Variance is PHP 0.00, no `close_variance` movement was created, one `register.closed` audit event and one `register.closed` outbox event exist, and there are zero open register sessions.

## Remaining gate

Receipt, Sales, Payments, Inventory, and Shifts & receipts reports were validated after the sale and after the refund. Remaining gate: Production rollback/release validation and final go-live approval.

No raw PIN, activation code, device token, access token, or database credential is included in this evidence.
