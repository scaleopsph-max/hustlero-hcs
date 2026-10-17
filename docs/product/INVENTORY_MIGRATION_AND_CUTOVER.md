# Inventory Migration and Cutover

## Purpose

Bring an operating retailer into HUSTLERO without losing product, branch, quantity, cost, or audit truth. Product setup and inventory posting remain separate even when the UI presents them as one guided onboarding flow.

## Locked workflow

1. Configure the tenant, branches, timezone, employees, registers, and payment methods.
2. Import or create the product master, variants, SKUs, barcodes, prices, costs, and inventory-tracking flags.
3. Configure reorder levels per branch and variant.
4. Upload an opening-inventory file for a declared cutover timestamp.
5. Run a dry validation without changing stock.
6. Resolve every blocking row error and review branch quantity and valuation totals.
7. Confirm and post the batch once.
8. Reconcile HUSTLERO totals against the source system.
9. Open registers and allow transactions only after the go-live gate passes.

## Import fields

Required:

- Branch code
- SKU or barcode
- Quantity on hand
- Cutover timestamp for the batch

Optional or conditionally required:

- Unit cost
- Reorder level
- Reserved quantity
- Damaged quantity
- In-transit quantity
- Source-system reference

Quantity uses integer thousandths at the API boundary. Money uses integer centavos at the API boundary and PostgreSQL `numeric` in storage.

## Validation rules

- Resolve the tenant only from the authenticated server context.
- Every branch and variant must belong to that tenant.
- A batch cannot contain duplicate branch and variant rows.
- SKU and barcode resolution must be unambiguous.
- Opening on-hand quantity cannot be negative.
- Reserved, damaged, and in-transit quantities cannot be negative.
- Reserved quantity cannot exceed the physically available quantity unless a future approved migration policy explicitly permits it.
- Unit cost is required when the opening quantity is positive and no trustworthy variant cost exists.
- Reorder level is non-negative and belongs to one branch and variant.
- A dry run never writes inventory movements or balances.

## Posting semantics

- The confirmed batch is atomic and idempotent.
- Every accepted row with positive opening stock posts an immutable `OPENING_BALANCE` movement. An accepted zero-quantity row creates a zero balance and optional reorder configuration without inventing a zero-value ledger movement.
- Balance rows are projections created from the posted movements, never direct source-of-truth overrides.
- Reorder levels are configuration records, not inventory movements.
- Retrying the same batch and content returns the stored result without duplicate stock.
- Reusing a batch key with different content is rejected.
- Posted batches cannot be deleted or edited. Corrections use reasoned adjustment or reversal movements.
- Audit and outbox records identify the tenant, importer, filename, batch ID, cutover timestamp, and reconciliation totals.

## Cutover control

The client declares one inventory cutover timestamp. Transactions before it belong to the source system; transactions after it belong to HUSTLERO. The source system must be frozen, or its final delta must be included, before the final batch is posted.

POS activation may be prepared earlier, but sale completion remains blocked until the migration batch is posted and reconciled for every required branch.

## User experience

- Product entry offers `Save product` and `Save and set opening stock` actions.
- Bulk onboarding offers downloadable product and inventory templates.
- Upload starts in Preview state with row-level errors and warnings.
- The confirmation screen shows accepted/rejected rows, quantities, and valuation by branch.
- Error rows can be downloaded for correction.
- Batch history preserves preview, posted, failed, and reconciled outcomes.
- Go-live readiness shows the exact blocking branch or batch instead of a generic pending status.

## First implementation slices

1. Branch-variant reorder-level schema, API, Inventory UI, low-stock projection, and alerts.
2. Import batch and row staging tables with CSV preview and validation.
3. Atomic opening-balance posting with audit, outbox, and idempotency.
4. Reconciliation summary and go-live readiness gate.
5. Product-form handoff to opening stock and downloadable migration templates.

## Implementation status

Slices 1-4 are deployed to the development environment. The Back Office preview now requires an explicit irreversible posting confirmation, followed by server-side reconciliation. POS sale completion remains locked per branch until reconciliation succeeds. Slice 5 product-form handoff remains a post-cutover usability enhancement and does not block the controlled pilot because manual entry and the downloadable CSV flow are available.

## Acceptance

- Cross-tenant branches, products, and rows are rejected.
- A preview causes zero stock changes.
- A valid confirmed batch posts exactly once.
- Inventory quantity and valuation reconcile to the approved source totals.
- Low-stock status uses the branch-specific reorder level.
- POS cannot complete a sale before the required branch cutover is ready.
