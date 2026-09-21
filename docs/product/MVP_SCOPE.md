# MVP Scope and Acceptance Criteria

## Objective

The MVP proves that one tenant can configure a real branch, load products and opening stock, activate a register, complete and reverse sales, close the register, and see trustworthy inventory and sales reporting without cross-tenant leakage.

## Included vertical slices

### 1. Tenant onboarding

- Account and business creation
- Main location
- Business timezone and currency
- Default payment methods
- Owner membership and role
- Initial register/device activation
- Resumable setup checklist

Acceptance: an owner can reach a verified Ready to Sell state without platform support.

### 2. Identity, employees, and permissions

- Back Office authentication
- Employee records and location assignments
- Default roles
- POS PIN login
- Employee deactivation with history preservation
- Server-side permission checks

Acceptance: an employee cannot read or mutate another tenant or an unassigned location through either UI or direct API calls.

### 3. Catalog and pricing

- Categories, products, variants, SKUs, and multiple barcodes
- Retail price and basic wholesale price-list support
- Activation/deactivation
- CSV import validation and preview

Acceptance: SKU uniqueness is enforced per tenant and used as the primary import match key.

### 4. Inventory foundation

- Opening inventory through ledger movements
- Per-location on-hand, reserved, available, in-transit, and damaged concepts
- Adjustments with reason and permission
- Stock movement history
- Low/out-of-stock visibility
- Moving weighted-average cost

Acceptance: no application path directly edits a balance without a corresponding immutable movement.

### 5. Register and POS sale

- Device/register association
- PIN login
- Open register and opening cash
- Product search/barcode entry
- Cart, quantity, customer, basic discount, and pricing type
- Cash, manual e-wallet, external card, and split-payment records
- Atomic sale completion and receipt
- Idempotent submission and visible connectivity state

Acceptance: retries cannot create duplicate sales, payments, or stock movements.

### 6. Exceptions and register close

- Held ticket without stock reservation
- Void before completion
- Full/partial/item refund through linked reversal
- Receipt search and reprint
- Cash in/out and shift expense
- Counted versus expected cash
- Manager approval and alert for configured variance

Acceptance: completed sales remain visible and every reversal is linked, permission-checked, and audited.

### 7. Customers and basic loyalty foundation

- POS-originated customer profile
- Purchase history and notes
- Optional loyalty ledger and balance
- Refund-driven point reversal

Acceptance: loyalty balance can be reproduced from its transaction ledger.

### 8. Dashboard and reports

- Date, location, and channel filters
- Net sales, gross profit, transactions, COGS, discounts, taxes, refunds
- Sales by item/category/employee/payment type
- Stock on hand, available, valuation, low stock, and movement history
- CSV export

Acceptance: dashboard totals reconcile to the underlying report and transaction records for the same scope.

### 9. Platform foundations

- Capability/entitlement model
- Tenant toggle and employee permission resolution
- Basic audit, alerts, approvals, notifications, and event outbox
- Super Admin tenant listing and time-boxed support-access foundation

Acceptance: subscription downgrade never deletes historical business data.

## Explicitly deferred from MVP

- BIR accreditation or certified fiscal-device integration
- Durable offline sale acceptance and conflict resolution
- Direct card/e-wallet charging
- Automated recurring subscription billing
- Ecommerce marketplace connectors and settlements
- Advanced wholesale receivables
- Warehouse optimization and multi-level approvals
- Payroll and advanced time clock
- AI anomaly/fraud detection
- Automatic real-bank fund movement

## MVP Definition of Done

MVP is done only when all included acceptance criteria pass, tenant-isolation tests pass, migrations are reproducible, responsive POS and Back Office workflows are verified, recovery tests pass, documentation is current, staging is verified, and rollback instructions exist.
