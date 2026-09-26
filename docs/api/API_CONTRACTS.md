# API Contract Map

## Conventions

- Base prefix: `/v1`
- JSON request/response contracts validated with shared Zod schemas
- IDs are UUID/ULID strings; human references are separate fields
- Money crosses the API as integer centavos or explicit decimal strings
- Dates use ISO 8601 with timezone
- Mutating critical commands accept `Idempotency-Key`
- Pagination uses opaque cursors for high-volume lists
- Every response includes or propagates a request ID

## Standard error envelope

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Two items are no longer available at this location.",
    "requestId": "req_...",
    "details": {}
  }
}
```

Error codes are stable and operational. Unknown payment state must never be reported as failed without reconciliation.

## Contract groups

### Identity and context

- `POST /v1/auth/exchange`
- `GET /v1/me`
- `GET /v1/tenants`
- `POST /v1/context/location`
- `POST /v1/pos/devices/activate`
- `POST /v1/pos/sessions/pin-login`

### Onboarding and tenancy

- `POST /v1/tenants`
- `GET/PATCH /v1/tenants/current`
- `POST/GET/PATCH /v1/locations`
- `GET/PATCH /v1/onboarding`
- `POST /v1/onboarding/go-live-check`

Current Phase 1 implementation:

- `POST /v1/tenants` requires a Supabase bearer token and a 16-128 character `Idempotency-Key`. Body: `name`, `slug`, optional `baseCurrency` (default `PHP`), optional `timezone` (default `Asia/Manila`), and `mainLocation` with `code` and `name`. It atomically creates the tenant, main store, owner membership and role, audit event, and outbox event. Identical retries replay the stored response; a changed body with the same key returns 409.
- `GET /v1/onboarding` requires an owner bearer token. `X-Tenant-Id` selects only a tenant found in that user's server-resolved memberships and is required when the user owns multiple tenants. It reports the full planned step sequence, including persisted completion for business, main location, questions, feature selection, products, and opening inventory; `readyToSell` remains false.
- `PATCH /v1/onboarding` requires the same owner context. `business_questions` stores business type, one or more sales channels, inventory-tracking preference, and product setup method. `feature_selection` can run only afterward and may toggle only the tenant's entitled core modules: inventory, purchasing, customers, employees, and finance.
- Catalog, sales, and basic reports are required core features and remain enabled. Unavailable paid add-ons cannot be selected or self-entitled through onboarding.
- Identical step retries return success without adding duplicate audit/outbox records. Changed saved answers create a new audit event and outbox event.
- The Products step becomes complete after the tenant has at least one non-archived product. Opening inventory completes after its first ledger movement. Later onboarding steps are not implemented yet.

### Catalog and inventory

- `GET /v1/catalog`
- `POST /v1/catalog/products`
- `PATCH /v1/catalog/products/{productId}`
- `POST /v1/catalog/products/{productId}/variants`
- `PATCH /v1/catalog/products/{productId}/variants/{variantId}`
- `DELETE /v1/catalog/products/{productId}/variants/{variantId}`
- `POST/GET/PATCH /v1/products`
- `POST/GET/PATCH /v1/variants`
- `GET /v1/catalog/search`
- `GET /v1/inventory/balances`
- `GET /v1/inventory/movements`
- `POST /v1/inventory/adjustments`
- `POST /v1/inventory/opening-balances`
- `GET /v1/inventory/opening-balances`
- `GET /v1/inventory/stock`
- `GET /v1/inventory/movements`

Current catalog implementation:

- Catalog endpoints require a Supabase bearer token and a server-resolved tenant membership. `X-Tenant-Id` cannot select a tenant outside that membership.
- Catalog reads require owner, `catalog.read`, or `catalog.manage` access. Product creation requires owner or `catalog.manage`, plus an active catalog entitlement.
- `POST /v1/catalog/products` requires a 16-128 character `Idempotency-Key` and creates one product with its initial variant, tenant-unique SKU, optional category, and optional barcode atomically.
- `POST /v1/catalog/products/{productId}/variants` adds a later variant to an existing tenant product. Variant labels can represent combinations such as `Black / XL`; each variant owns its tenant-unique SKU, optional barcode, price, cost, and inventory-tracking setting.
- `PATCH /v1/catalog/products/{productId}` edits product-master name, category, and description without flattening or recreating its variants.
- `PATCH /v1/catalog/products/{productId}/variants/{variantId}` edits the variant label, SKU, barcode, retail price, unit cost, and inventory-tracking setting.
- `DELETE /v1/catalog/products/{productId}/variants/{variantId}` deactivates the variant instead of deleting its row. Inactive variants are hidden from the active catalog, historical references remain intact, and a product must keep at least one active variant.
- Product prices cross the TypeScript boundary as integer centavos and are stored as PostgreSQL `numeric(18,2)`. SKU and barcode values are normalized before tenant-scoped uniqueness checks.
- The command writes one audit event and one outbox event. Identical retries replay the stored response; a changed payload with the same key returns 409.
- Catalog creation does not create or edit stock. Opening inventory remains a separate ledger-backed onboarding step.

Current opening-inventory implementation:

- `GET /v1/inventory/opening-balances` returns active inventory-tracked variants and their opening status for one server-authorized branch. Owners can select any active tenant branch; future employees are restricted to assigned branches.
- `POST /v1/inventory/opening-balances` requires an `Idempotency-Key` and one or more positive entries. Quantities cross the TypeScript boundary as integer thousandths and unit costs as integer centavos.
- The command atomically appends one `OPENING_BALANCE` movement per submitted variant and creates its branch balance projection. No direct balance overwrite path or direct Worker table grant exists.
- Opening inventory is one-time per branch and variant and must precede any other movement for that stock position. Corrections use future adjustment or reversal commands.
- Successful batches create one audit event and one outbox event. Identical retries replay the response; changed retries and duplicate openings return 409.
- The onboarding opening-inventory step becomes complete after the tenant records its first opening movement.

Current adjustment implementation:

- `POST /v1/inventory/adjustments` requires an `Idempotency-Key`, branch and variant references, a non-zero signed integer-thousandth quantity, optional integer-centavo unit cost, and a required human reason.
- The command is restricted to tenant owners or members with `inventory.manage`, requires opening inventory first, locks the branch/variant balance, appends an `ADJUSTMENT` movement, updates the balance atomically, and blocks negative on-hand or available stock.
- Successful adjustments create an audit event with the reason and one outbox event. Corrections remain append-only; no movement or balance row is edited directly.
- Approval thresholds are intentionally deferred until the Approvals module and tenant policy configuration are implemented; this slice enforces inventory-management authorization and auditability.

Current inventory visibility implementation:

- `GET /v1/inventory/stock` returns the live balance projection for active inventory-tracked variants at a server-authorized branch. `available` is computed as `on_hand - reserved`; quantities cross the TypeScript boundary as integer thousandths.
- `GET /v1/inventory/movements` returns the newest ledger rows for a server-authorized branch, optionally filtered by variant and limited to 1-200 rows. Each row includes movement type, quantity, source reference, actor label, timestamp, and computed balance after.
- Both read paths use private security-definer functions with pinned search paths and execute permission only for the Hyperdrive role. Direct table reads remain denied.

### Registers and sales

- `GET /v1/register-operations`
- `POST /v1/payment-methods`
- `POST /v1/register-sessions/open`
- `GET /v1/register-sessions/current`
- `POST /v1/register-sessions/{id}/cash-movements`
- `POST /v1/register-sessions/{id}/close-preview`
- `POST /v1/register-sessions/{id}/close`
- `POST /v1/sales/quote`
- `POST /v1/sales/complete`
- `GET /v1/sales/{id}`
- `GET /v1/receipts`
- `POST /v1/sales/{id}/refunds`
- `POST /v1/sales/{id}/void`

Current register foundation:

- `GET /v1/register-operations` returns active payment methods, active employees and branch assignments, registers and their current open session, plus the latest 50 sessions.
- Every tenant starts with Cash, E-wallet, Bank Transfer, and Card Terminal methods. Additional manual methods are owner-created through an idempotent command; no direct payment-provider charging occurs.
- `POST /v1/register-sessions/open` accepts a register, an active employee assigned to that register's location, and integer-centavo opening cash. It atomically opens the session and appends the opening cash movement.
- Only one open session may exist per register. `POST /v1/register-sessions/{id}/close` calculates expected cash from the append-only cash ledger, records counted cash and variance, and marks a non-zero variance as an explicit exception.
- Open/close commands are currently Back Office owner operations for controlled development. The new device and employee session identity will authorize their POS-native equivalents in the sales slice.

Current POS identity foundation:

- `GET /v1/pos/devices` returns only registers and devices belonging to the authenticated server-resolved tenant.
- `POST /v1/pos/devices/activation-codes` is owner-only and creates a 12-character one-time code that expires after 15 minutes. The API returns the raw code once; PostgreSQL stores only its SHA-256 hash.
- `POST /v1/pos/devices/activate` consumes the one-time code and returns an opaque 256-bit device token. The token binds the device to its tenant, branch, and register; only the token hash is stored.
- `POST /v1/pos/sessions/pin-login` requires the device token in `X-POS-Device-Token`, an active employee code assigned to that device branch, and a valid 4-6 digit PIN. Five failed PIN attempts lock that employee credential for 15 minutes.
- A successful PIN login revokes the device's previous employee session and returns a new opaque 12-hour session token. Only its hash is stored. Future sales commands derive tenant, branch, register, and employee from this session instead of accepting those identifiers from the POS client.

Current POS cash-sales implementation:

- `GET /v1/pos/context` requires `X-POS-Session-Token` and returns only the server-resolved employee, activated device, branch, register, current register session, active branch catalog, availability, and configured payment methods.
- `POST /v1/pos/register-sessions/open` requires the POS session and `Idempotency-Key`; the request contains only integer-centavo opening cash. The employee, register, location, and tenant come from the POS session.
- `POST /v1/pos/sales/complete` currently accepts cash sales with unique lines containing only `variantId` and positive integer-thousandth `quantityMilli`, plus integer-centavo `cashReceivedCentavos`. Client prices and totals are ignored by the strict contract.
- PostgreSQL locks the register session, variants, and inventory balances; recalculates retail totals; rejects unavailable stock; and atomically writes the sale, immutable line snapshots, payment tender/change, inventory and cash ledger rows, audit event, outbox event, and branch daily receipt number.
- Identical retries return the stored receipt. Reusing a key with a different request returns 409. Expired POS sessions return 401; closed registers and insufficient stock return 409.
- `GET /v1/sales` requires a bearer-authenticated server-resolved tenant with `sales.read` access and returns the latest 100 tenant receipts for Back Office.
- `GET /v1/sales/{id}` returns immutable receipt, line, payment, and linked reversal snapshots plus server-computed remaining refundable quantities.
- `POST /v1/sales/{id}/refunds` accepts only sale-line IDs, integer-thousandth quantities, return-to-stock choices, and a reason. PostgreSQL calculates the amount from the original sale snapshots and atomically appends the refund, item, payment, inventory, cash, audit, and outbox records.
- `POST /v1/sales/{id}/void` accepts only a reason and reverses every remaining line of a completed cash sale. The original receipt is retained and marked `voided`.
- Cash refunds and voids currently require the original register session to remain open. A closed register is never silently changed after reconciliation; cross-session refund settlement is a later explicit workflow.
- Back Office receipt reprint uses the immutable receipt detail and a print-specific layout. Printing never edits the original sale.

### Customers, controls, and reporting

- `GET /v1/customers` supports tenant-scoped search by name, customer number, email, or phone and returns customer groups plus server-derived net spend and visit counts.
- `POST /v1/customers` and `PATCH /v1/customers/{id}` require bearer authentication, server-resolved tenant context, permissions, strict contact/consent fields, and an `Idempotency-Key`.
- `GET /v1/customers/{id}` returns profile, consent, append-only notes, and linked purchase/refund history. Spend and visits are derived from sale and reversal truth rather than mutable counters.
- `POST /v1/customers/{id}/notes` appends an attributed note; customer notes cannot be edited or deleted.
- `GET /v1/pos/customers` searches only active customers in the POS session's tenant. `POST /v1/pos/customers` creates a tenant/branch-attributed profile from the active employee session.
- `POST /v1/pos/sales/complete` accepts an optional customer ID. PostgreSQL validates that the selected active customer belongs to the POS tenant and links the sale atomically; prices, totals, tenant, branch, register, and employee remain server-authoritative.
- `GET /v1/loyalty` returns the tenant policy, aggregate account totals, and recent immutable point transactions. It requires server-resolved tenant membership and `loyalty.read` permission.
- `PATCH /v1/loyalty/policy` requires `loyalty.manage`, an `Idempotency-Key`, and a positive integer-centavo spend amount before earning can be enabled. Loyalty is disabled with no arbitrary rate for new tenants.
- A newly committed customer-linked POS sale earns `floor(total centavos / configured spend per point)` only while the policy is enabled. The transaction stores the rate snapshot and the POS response returns points earned and the resulting balance.
- Completed refunds append proportional negative point transactions using the original sale's rate snapshot. Policy changes never recalculate prior earnings, and the account balance must equal the sum of its immutable ledger.
- `GET/POST /v1/approvals`
- `POST /v1/approvals/{id}/decisions`
- `GET /v1/alerts` requires server-resolved tenant membership and `alerts.read`. It synchronizes deterministic conditions before returning status counts, management capability, and tenant-scoped alert records.
- The first rule set opens warning alerts for active tracked variants with zero or negative branch availability and attention alerts for closed register sessions with a non-zero cash variance. Out-of-stock alerts resolve automatically after availability becomes positive; no low-stock rule exists until an explicit reorder point is configured.
- `PATCH /v1/alerts/{id}` requires `alerts.manage` and accepts `acknowledged`, `resolved`, or `dismissed` plus an optional note. Setting the same state is naturally idempotent; actual transitions append an audit event and alert records cannot be deleted.
- `GET /v1/audit-activity` requires `audit.read`, inclusive ISO business dates, and accepts optional location, actor type, action, entity type, search, limit, and offset filters. It reads append-only business audit events only; technical request logs remain separate.
- `GET /v1/notifications` returns only the authenticated tenant member's recipient-specific history, unread count, linked record, location, and per-channel delivery status. `unreadOnly`, `limit`, and `offset` are validated server-side.
- `PATCH /v1/notifications/{id}` sets that recipient's read/unread state. Reading a notification never acknowledges or resolves its linked alert or approval.
- `PATCH /v1/notifications/read-all` marks the current member's unread notifications as read. Alert and pending-approval notifications are materialized idempotently from server-owned records and routed by role capability; email remains `not_configured` until a provider is selected.
- `GET /v1/dashboard`
- `GET /v1/reports/sales`
- `GET /v1/reports/inventory`
- The three reporting reads require `from` and `to` ISO business dates, accept an optional tenant-owned `locationId`, and currently accept `channel=all|pos`. Date ranges are inclusive and limited to 367 business days.
- Dashboard and sales-report totals share one PostgreSQL projection. Gross sales use sale commit dates; refunds use reversal commit dates; net COGS reverses the original line-cost snapshot on the refund date; gross profit is net sales less net COGS.
- Inventory reporting is a current balance snapshot. Stock valuation is on-hand quantity multiplied by the current average unit cost. Out-of-stock is available quantity less than or equal to zero; low-stock remains unclassified until the tenant configures an explicit reorder point.
- Basic CSV downloads serialize the validated sales and inventory report payload already shown to the user. The asynchronous `POST /v1/exports` contract remains reserved for large, scheduled, or custom exports.
- `POST /v1/exports`

## Command safety

- The API derives tenant, actor, employee, location, and device context from trusted authentication/device state.
- Clients never submit authoritative cost, COGS, tax outcome, available stock, entitlement, permission, expected cash, or ledger balances.
- Critical command responses are stored against the idempotency record and replayed for identical retries.
- A reused key with a different request hash is rejected.
- Secondary delivery failures appear as warnings without changing a committed transaction to failed.

## Contract completion gate

Before implementing a slice, define schemas, permission code, idempotency behavior, database transaction, domain events, audit event, error codes, and integration tests for every endpoint in that slice.
