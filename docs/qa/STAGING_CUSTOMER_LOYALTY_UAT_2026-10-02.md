# Staging Customer and Loyalty UAT - 2026-10-02

## Scope

Controlled customer and loyalty validation against the isolated `HUSTLERO HCS Staging` environment. The test used generated customer data, one generated catalog item, and a same-session sale and full refund so inventory, cash, net spend, and loyalty balance returned to their starting values.

## Test Record

- Business: `PABL0`
- Customer: `CUST-000001` / `UAT Customer 001`
- Customer ID: `7f8d3167-42aa-4128-9ad5-79137f1d0151`
- Loyalty policy: enabled, PHP 100.00 spend per point
- Receipt: `MAIN-20261002-000001`
- Sale ID: `5fd4c216-81a3-45f1-8caa-dc1ee353ea7b`
- Refund ID: `87c16a21-dcb5-4024-b700-d22d8afd66c8`
- Product variant: `P-00001`
- Sale and refund amount: PHP 999.00
- Register opening and closing cash: PHP 1,000.00

## Verification Results

| Check | Result |
| --- | --- |
| Customer creation | Passed: one active generated Back Office customer with counter `CUST-000001`, one creation audit event, and one creation outbox event |
| Consent defaults | Passed: email and SMS marketing consent remained off |
| Loyalty policy | Passed: earning was enabled at exact rate PHP 100.00 per point with matching policy audit and outbox events |
| POS customer search | Passed: POS found and attached `CUST-000001` before checkout |
| Customer-linked sale | Passed: receipt `MAIN-20261002-000001` links the generated customer and exactly one P-00001 unit |
| Loyalty earning | Passed: PHP 999.00 earned 9 points using the stored 10,000-centavo rate snapshot |
| Full refund | Passed: exactly one PHP 999.00 refund returned the item to stock |
| Loyalty reversal | Passed: one append-only `-9` reversal returned the account balance to 0 |
| Customer metrics | Passed: one visit is retained, net spend is PHP 0.00, lifetime earned is 9, and lifetime reversed is 9 |
| Inventory reconciliation | Passed: P-00001 posted `SALE -1` then `REFUND +1` and finished at 9 on hand / 9 available |
| Cash reconciliation | Passed: PHP 999.00 cash sale and PHP -999.00 cash refund netted to zero |
| Register reconciliation | Passed: opening, expected, and counted cash were PHP 1,000.00 with PHP 0.00 variance |
| Audit events | Passed: sale completion, customer link, point earn, point reversal, refund, and register close each exist exactly once |
| Outbox events | Passed: matching sale, customer-link, loyalty earn/reversal, refund, and register-close events each exist exactly once |
| UI verification | Passed: receipt, customer profile, purchase history, loyalty activity, and session history all matched database truth |

## Conclusion

The Staging customer and loyalty path passed from generated customer creation through POS selection, customer-linked checkout, exact-rate point earning, full refund, automatic point reversal, inventory restoration, cash reconciliation, customer history, audit, and outbox verification.

This report does not sign off the complete pilot. Remaining broader-module UAT, backup restore, Worker rollback, and final owner release approval remain separate gates.
