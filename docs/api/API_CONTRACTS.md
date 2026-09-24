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
- `GET /v1/onboarding` requires an owner bearer token. `X-Tenant-Id` selects only a tenant found in that user's server-resolved memberships and is required when the user owns multiple tenants. It reports the full planned step sequence; currently only business and main location can be complete, and `readyToSell` remains false.
- `PATCH /v1/onboarding` requires the same owner context. `business_questions` stores business type, one or more sales channels, inventory-tracking preference, and product setup method. `feature_selection` can run only afterward and may toggle only the tenant's entitled core modules: inventory, purchasing, customers, employees, and finance.
- Catalog, sales, and basic reports are required core features and remain enabled. Unavailable paid add-ons cannot be selected or self-entitled through onboarding.
- Identical step retries return success without adding duplicate audit/outbox records. Changed saved answers create a new audit event and outbox event.
- Remaining onboarding steps are not implemented yet. The Back Office dashboard and inventory prototype still use sample data.

### Catalog and inventory

- `POST/GET/PATCH /v1/products`
- `POST/GET/PATCH /v1/variants`
- `GET /v1/catalog/search`
- `GET /v1/inventory/balances`
- `GET /v1/inventory/movements`
- `POST /v1/inventory/adjustments`
- `POST /v1/inventory/opening-balances`

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
