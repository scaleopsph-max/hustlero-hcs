# Production Advanced Wholesale AW2 UAT - 2026-10-10

## Approved scope

The owner approved a permanent Production order for 10 SAH-00001 units at PHP 450.00 each, fulfilled in two batches of five. The owner was informed that invoices are permanent and AW4 returns/credits are not implemented.

## Observed results

- Tenant: SAH RESTORATION; location: Main Store; reseller: CUST-000001.
- Advanced Wholesale entitlement was granted with a reason and the owner-authorized tenant toggle was saved successfully.
- Order SO-20261010-001 was created for PHP 4,500.00. Draft creation left available inventory at 95.
- Confirmation reserved 10 shared-stock units and reduced available inventory to 85.
- The first five-unit fulfillment issued INV-20261010-000001 for PHP 2,250.00 and changed the order to partially fulfilled with five units remaining.
- The final five-unit fulfillment issued INV-20261010-000002 for PHP 2,250.00 and changed the order to fulfilled.
- Both invoice pages show five SAH-00001 units at PHP 450.00, zero discount/tax, and the originating order and reseller.
- Final inventory UI shows 85 on hand, zero reserved, 85 available, zero damaged, zero in transit, and PHP 250.00 average cost.
- Latest movements show two owner-attributed sales of -5 units, with balances 90 and 85.
- Wholesale invoice refund/void controls are disabled for the AW4 boundary. Payment terms and allocations remain the AW3 boundary; no payment was posted.

## Evidence limits

Results above were verified through the authenticated Production Back Office UI. Direct database audit/outbox counts, concurrent retry/idempotency tests, and report aggregation were not independently queried in this UAT. Existing CI/database regression coverage is separate from these observations.

## Next slice

Implement AW3 payment terms and allocations according to the locked Advanced Wholesale blueprint. Retain both Production invoices and their stock movements; do not remove or manually reverse their history.
