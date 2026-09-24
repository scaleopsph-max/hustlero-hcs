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
- The Products step becomes complete after the tenant has at least one non-archived product. Opening inventory completes after its first ledger movement. Later onboarding steps are not implemented yet; the general stock-level explorer still uses sample data.

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

### Registers and sales

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

### Customers, controls, and reporting

- `POST/GET/PATCH /v1/customers`
- `GET /v1/customers/{id}/activity`
- `GET/POST /v1/approvals`
- `POST /v1/approvals/{id}/decisions`
- `GET/PATCH /v1/alerts`
- `GET/PATCH /v1/notifications`
- `GET /v1/dashboard`
- `GET /v1/reports/sales`
- `GET /v1/reports/inventory`
- `POST /v1/exports`

## Command safety

- The API derives tenant, actor, employee, location, and device context from trusted authentication/device state.
- Clients never submit authoritative cost, COGS, tax outcome, available stock, entitlement, permission, expected cash, or ledger balances.
- Critical command responses are stored against the idempotency record and replayed for identical retries.
- A reused key with a different request hash is rejected.
- Secondary delivery failures appear as warnings without changing a committed transaction to failed.

## Contract completion gate

Before implementing a slice, define schemas, permission code, idempotency behavior, database transaction, domain events, audit event, error codes, and integration tests for every endpoint in that slice.
