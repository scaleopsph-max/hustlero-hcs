# Staging Cash Refund UAT - 2026-10-01

## Scope

Controlled same-session cash refund validation against the isolated `HUSTLERO HCS Staging` environment. This test used generated UAT data only and did not involve a real payment.

## Test Record

- Business: `PABL0`
- Location: `Main Store`
- Register: `Main Register`
- Cashier: `PABL0 Cashier` (`EMP-001`)
- Register session: `7b0d7614-3597-4242-a71b-7f80f7ed8a11`
- Opening cash: PHP 1,000.00
- Receipt: `MAIN-20261001-000002`
- Sale ID: `837793ef-9e0e-4621-802f-b1b447249b8f`
- Item: 1 x `P-00001` at PHP 999.00
- Cash tendered: PHP 1,000.00
- Change: PHP 1.00
- Refund ID: `de800a9a-056f-44fb-8476-a5186507a96c`
- Refund reason: `Controlled Staging UAT full refund`

## Verification Results

| Check | Result |
| --- | --- |
| Sale posting | Passed: exactly one PHP 999.00 completed sale was created before reversal |
| Refund header | Passed: exactly one completed PHP 999.00 refund; sale status is `refunded` |
| Refund item | Passed: exactly one unit was refunded and marked returned to stock |
| Payment reversal | Passed: exactly one completed PHP 999.00 payment reversal |
| Inventory ledger | Passed: `SALE -1` moved P-00001 from 9 to 8, then `REFUND +1` restored it to 9 |
| Cash ledger | Passed: exactly one `cash_refund -999.00`; session cash net returned to PHP 1,000.00 |
| Audit event | Passed: exactly one `sale.refunded` event with the controlled reason |
| Event outbox | Passed: exactly one pending `sale.refunded` event |
| Sales report | Passed: PHP 1,998.00 gross sales, PHP 999.00 refunds, PHP 999.00 net sales |
| Profit report | Passed: PHP 499.00 COGS and PHP 500.00 gross profit after reversal |
| Register close | Passed: PHP 1,000.00 expected and counted, zero variance, no variance movement |
| Close audit and outbox | Passed: exactly one `register.closed` audit event and one outbox event |

## Boundary Confirmed

The supported reversal flow requires the original register session to remain open. The earlier receipt `MAIN-20261001-000001` correctly blocked reversal after its register session closed. Cross-session cash refunds remain a separate product capability and are not claimed as implemented by this UAT.

## Conclusion

The same-session full cash refund path passed end to end. The original sale remains immutable, all reversal records are linked and append-only, stock and cash returned to their pre-test balances, reporting reconciles, and the register closed without variance.

This report does not sign off the complete pilot. Broader module UAT, backup restore, Worker rollback, and final owner release approval remain separate gates.
