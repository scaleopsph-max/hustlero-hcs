# Staging Branch Transfer UAT - 2026-10-01

## Scope

Controlled branch-transfer validation against the isolated `HUSTLERO HCS Staging` environment. The test created one generated destination store and moved generated UAT inventory only.

## Test Record

- Business: `PABL0`
- Source: `Main Store` (`MAIN`)
- Destination: `UAT Branch 2` (`UAT-BR2`)
- Destination location ID: `e45f8325-1628-458a-8c3a-8fa6b4ce8289`
- Transfer: `TR-UAT-20261001-001`
- Transfer ID: `3f8b89b3-327a-4a51-8c92-a012ba9f3c81`
- Product variant: `P-00002`
- Quantity: 2
- Transfer unit cost: PHP 490.83

## Verification Results

| Check | Result |
| --- | --- |
| Destination creation | Passed: one generated store location with one `location.created` audit event |
| Business location summary | Passed: the authenticated sidebar updated from 1 to `2 locations` |
| Draft transfer | Passed: exactly one transfer and one item for two P-00002 units |
| Draft stock behavior | Passed: draft creation did not change inventory |
| Dispatch source balance | Passed: Main Store P-00002 moved from 12 to 10 |
| Dispatch destination balance | Passed: UAT Branch 2 showed 0 on hand and 2 in transit |
| Dispatch movement | Passed: exactly one `TRANSFER_OUT -2` movement |
| Receipt destination balance | Passed: UAT Branch 2 moved to 2 on hand, 2 available, and 0 in transit |
| Receipt movement | Passed: exactly one `TRANSFER_IN +2` movement |
| Completion transition | Passed: requested 2, received 2, final status `received` |
| Combined stock | Passed: Main Store 10 plus UAT Branch 2 2 preserved all 12 P-00002 units |
| Cost preservation | Passed: both branches retain PHP 490.83 average unit cost |
| Inventory valuation | Passed: total valuation remained PHP 10,380.96 before and after transfer |
| Transfer audit events | Passed: one each for create, dispatch, and receive |
| Transfer outbox events | Passed: matching create, dispatch, and receive events exist exactly once |
| Alert lifecycle | Passed: dispatch opened an out-of-stock warning at the destination; receipt automatically resolved it |
| Notification history | Passed: the delivered in-app warning remained available after alert resolution |

## Conclusion

The Staging branch-transfer path passed from destination setup through draft, dispatch, in-transit control, full receipt, inventory posting, cost preservation, valuation reconciliation, audit, outbox, alert, and notification verification. No sale was created by the transfer.

This report does not sign off the complete pilot. Customer and loyalty plus the remaining broader module UAT, backup restore, Worker rollback, and final owner release approval remain separate gates.
