# Database Blueprint

## Principles

- PostgreSQL is the source of truth.
- Every tenant-owned row includes `tenant_id` unless ownership is inherited through an intentionally constrained parent and documented.
- Transaction tables use immutable identifiers and human-readable tenant-scoped references.
- Money uses `numeric` in PostgreSQL and integer minor units at TypeScript boundaries.
- Time uses `timestamptz`.
- Transactional truth is append-only; mutable balance tables are projections protected by controlled services.
- All exposed tables use explicit grants and RLS. No table is assumed exposed by default.

## Schema boundaries

| Schema | Purpose | Data API exposure |
| --- | --- | --- |
| `public` | Minimal client-safe/profile surfaces if required | Explicit opt-in only |
| `app` | Core tenant business tables | Not directly exposed by default |
| `audit` | Append-only audit and access events | Server-only |
| `integration` | Outbox, webhook receipts, sync state | Server-only |
| `reporting` | Security-invoker views/materialized projections | Controlled |

## Core entity groups

### Platform and tenancy

- `tenants`
- `tenant_settings`
- `locations`
- `registers`
- `devices`
- `users`
- `employees`
- `tenant_memberships`
- `employee_locations`
- `roles`, `permissions`, `role_permissions`, `membership_roles`
- `features`, `tenant_entitlements`, `tenant_feature_settings`

### Catalog and pricing

- `categories`
- `products`
- `product_variants`
- `product_barcodes`
- `price_lists`
- `price_list_items`
- `customer_groups`

### Inventory and purchasing

- `inventory_movements`
- `inventory_balances`
- `inventory_reservations`
- `inventory_adjustments`
- `suppliers`, `supplier_products`
- `purchase_orders`, `purchase_order_items`
- `goods_receipts`, `goods_receipt_items`
- `replenishment_requests`, `replenishment_request_items`
- `stock_transfers`, `stock_transfer_items`, `transfer_discrepancies`

### POS and sales

- `register_sessions`
- `sales`
- `sale_items`
- `payments`
- `refunds`, `refund_items`, `payment_reversals`
- `cash_movements`
- `held_tickets`, `held_ticket_items`
- `receipt_sequences`
- `idempotency_records`

### Customers and loyalty

- `customers`
- `customer_notes`
- `loyalty_accounts`
- `loyalty_transactions`

### Control and operations

- `approval_requests`, `approval_actions`
- `risk_alerts`
- `notifications`, `notification_deliveries`
- `files`, `file_versions`, `entity_files`
- `import_jobs`, `import_job_rows`
- `audit.audit_events`
- `integration.event_outbox`
- `integration.webhook_receipts`

## Required constraints

- SKU: unique `(tenant_id, normalized_sku)` for active and retained records.
- Barcode: unique `(tenant_id, barcode)` unless an approved weighted-barcode rule applies.
- Register code: unique `(tenant_id, location_id, code)`.
- Human references: unique `(tenant_id, reference_type, sequence_value)` or equivalent sequence strategy.
- Inventory quantity: movement quantity cannot be zero; direction/type determines sign rules.
- Payments: amount must be positive; reversals are separate linked records.
- Tenant ownership: child and parent tenant IDs must match, enforced through composite foreign keys or transaction-safe validation.
- State transitions: completed/closed records cannot return to draft through ordinary updates.
- Idempotency: unique `(tenant_id, operation, idempotency_key)` with request hash and stored outcome.
- External ingest: unique `(tenant_id, channel, external_id)`.

## Index baseline

Every foreign key used in joins receives a supporting index. High-volume tenant tables begin with tenant-leading indexes aligned to real queries, including:

- `(tenant_id, location_id, occurred_at desc)` for movements and sales
- `(tenant_id, status, created_at)` for approvals, alerts, jobs, and orders
- `(tenant_id, normalized_sku)` and `(tenant_id, barcode)` for POS lookup
- `(tenant_id, customer_id, completed_at desc)` for purchase history
- Partial indexes for active records and actionable states where selectivity warrants them

Indexes are validated with representative `EXPLAIN (ANALYZE, BUFFERS)` tests before production.

## RLS model

- Enable RLS on every exposed table.
- Revoke default privileges and grant only required operations.
- Resolve membership through trusted user-to-tenant membership records.
- Use separate policies for select, insert, update, and delete.
- Update policies require both `USING` and `WITH CHECK`.
- Never authorize using editable user metadata.
- Keep privileged functions outside exposed schemas, revoke public execute, validate caller identity, and minimize `security definer` use.
- Create allow and deny database tests for anonymous, authenticated, cross-tenant, wrong-location, deactivated-user, and elevated-support cases.

## Concurrency rules

- Lock or atomically compare the relevant inventory projection before accepting stock-consuming operations.
- Use transaction-scoped reference generation.
- Prevent two open sessions for a register unless an explicit recovery workflow resolves the first.
- Use state/version checks for transfer dispatch/receive and register close.
- Process outbox rows with claim/lease semantics and deduplication.

## Proposed migration sequence

```text
001_extensions_and_schemas
002_tenants_and_locations
003_identity_employees_and_roles
004_features_and_entitlements
005_catalog_and_pricing
006_inventory_core
007_registers_and_devices
008_sales_and_payments
009_refunds_and_cash
010_customers_and_loyalty
011_approvals_alerts_and_audit
012_files_imports_and_notifications
013_outbox_and_integrations
014_reporting_views_and_indexes
015_seed_reference_data
```

Each migration includes rollback notes, security review, and local verification. Production-applied migrations are immutable.
