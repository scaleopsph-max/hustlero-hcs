# Inventory Cutover Validation - 2026-09-28

## Scope

Controlled development validation against the permanent `SCALEOPS PH` test tenant and `Main Store (MAIN)`. No production environment exists and no production data was used.

## Fixture

- Product: `CUTOVER VALIDATION ITEM`
- Variant: `DEFAULT`
- SKU: `CUTOVER-UAT-001`
- Batch: `53c97505-8e61-46d8-89d9-227e4695c99f`
- Source reference: `HCS-CUTOVER-UAT-001`
- Input: 7 on hand, 1 reserved, 1 damaged, 2 in transit, PHP 50.00 unit cost, reorder level 3

The local CSV is stored under the ignored `artifacts/private/` directory and is not part of the public repository.

## Results

| Check | Result |
| --- | --- |
| CSV preview | Passed: 1 row accepted, 0 rejected |
| Preview totals | Passed: quantity 7, valuation PHP 350.00 |
| Preview isolation | Passed: no balance or movement existed before posting |
| POS pre-reconciliation gate | Passed: the pending accepted batch blocked cutover readiness |
| Atomic posting | Passed: batch changed to `posted` and the expected stock projection was created |
| Immutable ledger | Passed: one `OPENING_BALANCE` movement for quantity 7 at PHP 50.00 |
| Reconciliation | Passed: quantity and valuation matched the approved staging row |
| POS post-reconciliation gate | Passed: no pending cutover batch remained |
| Inventory projection | Passed: on hand 7, available 6, reserved 1, damaged 1, in transit 2 |
| Reorder policy | Passed: branch-variant reorder level 3 |
| Audit and outbox | Passed: previewed, posted, and reconciled each emitted one audit and one outbox event |
| Browser smoke test | Passed: reconciled item and opening movement rendered in Back Office Inventory |

## Conclusion

The approved opening-inventory migration flow is validated end to end in development. The batch is intentionally permanent test evidence; corrections must use inventory adjustments rather than deletion or mutation.
