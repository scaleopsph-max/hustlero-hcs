# Staging Purchasing and Receiving UAT - 2026-10-01

## Scope

Controlled supplier, purchase-order, and goods-receipt validation against the isolated `HUSTLERO HCS Staging` environment. This test used generated UAT data only and did not create a real supplier commitment or payment.

## Test Record

- Business: `PABL0`
- Receiving location: `Main Store`
- Supplier: `Staging Supplier 001`
- Supplier ID: `2aab6899-8853-412d-abfd-48afaa28ad25`
- Purchase order: `PO-UAT-20261001-001`
- Purchase order ID: `735f9458-03af-4c6a-b665-10dd0504c244`
- Product variant: `P-00002`
- Ordered and received quantity: 2
- Unit cost: PHP 450.00
- Purchase-order total: PHP 900.00
- Delivery reference: `DR-UAT-20261001-001`
- Purchase receipt ID: `9b82d4a4-8a8d-4646-9140-8eaa17f30ad9`

## Verification Results

| Check | Result |
| --- | --- |
| Supplier creation | Passed: one generated active supplier was created |
| Draft purchase order | Passed: exactly one line for two P-00002 units at PHP 450.00 |
| Purchase-order total | Passed: PHP 900.00 displayed and persisted |
| Send transition | Passed: order moved from `draft` to `ordered` |
| Goods receipt | Passed: exactly one receipt and one receipt line for two units |
| Completion transition | Passed: ordered 2, received 2, final status `received` |
| Inventory ledger | Passed: exactly one `PURCHASE_RECEIPT +2` movement at PHP 450.00 |
| Stock balance | Passed: P-00002 moved from 10 to 12 on hand and available |
| Weighted average cost | Passed: PHP 499.00 changed to PHP 490.83 |
| Inventory valuation | Passed: P-00002 value is PHP 5,889.96; total current valuation is PHP 10,380.96 |
| Audit events | Passed: one each for supplier creation, PO creation, PO send, and receipt posting |
| Event outbox | Passed: matching PO create/send and purchase-received events exist exactly once |

## Conclusion

The Staging purchasing path passed from supplier creation through draft, send, full receiving, inventory posting, weighted-cost recalculation, reporting, audit, and outbox verification. Drafting and sending did not change stock; the inventory change occurred only when the receipt posted.

This report does not sign off the complete pilot. Transfers and the remaining broader module UAT, backup restore, Worker rollback, and final owner release approval remain separate gates.
