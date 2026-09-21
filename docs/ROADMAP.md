# Development Roadmap

Estimates are planning ranges, not delivery promises. They assume focused implementation, timely owner decisions, and no certification program inside MVP.

## Phase 0 - Foundation and approval

Estimated: 3-5 working days

- Complete and review this foundation pack
- Resolve recorded owner decisions
- Import and upgrade the approved UI prototype
- Run Cloudflare compatibility spike
- Approve blueprint

Exit: `APPROVED BLUEPRINT - PROCEED TO BUILD`

## Phase 1 - Platform skeleton

Estimated: 1-2 weeks

- Monorepo tooling and CI
- Local Supabase environment and migrations
- Auth, tenant memberships, locations, roles, permissions
- API request context, audit, idempotency, and outbox foundations
- App shells and shared contracts

## Phase 2 - Catalog and inventory

Estimated: 2-3 weeks

- Products, variants, SKU/barcodes, prices
- Opening stock and inventory ledger
- Balance projection and stock search
- Imports, adjustments, and inventory UI

## Phase 3 - Register and sales

Estimated: 3-4 weeks

- Device activation and employee PIN
- Register open/cash ledger
- POS cart, pricing, checkout, payments, and receipts
- Atomic sale completion and idempotency
- Refunds, voids, and close reconciliation

## Phase 4 - Customers, controls, and reporting

Estimated: 2-3 weeks

- Customers and loyalty foundation
- Approvals, alerts, notifications
- Dashboard, reports, and CSV exports
- Entitlements and basic Super Admin operations

## Phase 5 - Hardening and pilot

Estimated: 2-3 weeks

- Full QA, responsive and accessibility work
- Security and tenant-isolation audit
- Performance and recovery testing
- Staging/UAT, production runbooks, backup/restore test
- Controlled pilot release

## Post-MVP sequence

Purchasing and suppliers -> transfers/restock -> advanced finance -> wholesale -> ecommerce/order engine -> marketplace settlement -> advanced offline -> advanced controls and analytics.
