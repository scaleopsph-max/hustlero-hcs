# Decision Register

## Accepted foundation decisions

| ID      | Decision                                                                                                                                                        | Rationale                                                                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-001 | Start as a modular monolith                                                                                                                                     | Lower operational complexity and stronger transactional consistency                                                                                                             |
| ADR-002 | Use Supabase PostgreSQL and Auth                                                                                                                                | Managed PostgreSQL, identity, backups, and RLS support                                                                                                                          |
| ADR-003 | Use Cloudflare Workers for deployable applications/API                                                                                                          | Edge delivery, isolated deployments, queues, and observability                                                                                                                  |
| ADR-004 | Use a Worker-native API framework                                                                                                                               | Better runtime fit than carrying a Node-oriented NestJS stack to Workers                                                                                                        |
| ADR-005 | Keep one repository with separate deployable apps                                                                                                               | Shared contracts/UI and atomic cross-app changes                                                                                                                                |
| ADR-006 | Use append-only ledgers and reversal records                                                                                                                    | Auditability and reproducible inventory/financial truth                                                                                                                         |
| ADR-007 | Keep Data API exposure explicit and minimal                                                                                                                     | Reduce accidental table exposure and authorization surface                                                                                                                      |
| ADR-008 | Keep POS online-first for MVP                                                                                                                                   | Avoid unsafe offline conflict behavior before policies are proven                                                                                                               |
| ADR-009 | Use HUSTLERO (HCS) as the current product name                                                                                                                  | Supersedes the legacy product heading without changing locked business behavior                                                                                                 |
| ADR-010 | Keep the initial adaptive-onboarding questionnaire small and reversible                                                                                         | Business type, sales channels, inventory tracking, and product setup method are sufficient to tailor early setup without locking the tenant into an irreversible classification |
| ADR-011 | Enable catalog, sales, and basic reports for every tenant; let owners toggle only entitled core modules during onboarding                                       | Preserves a usable free/core path and prevents tenant owners from self-entitling unavailable paid add-ons                                                                       |
| ADR-012 | Start catalog setup with one product and one required initial variant per command; keep opening stock separate                                                  | Preserves the Product → Variant → SKU → Barcode model while ensuring product creation never mutates inventory balances outside the ledger                                       |
| ADR-013 | Add later variants to an existing product using a compact variant label such as `Black / XL`; keep SKU, barcode, pricing, and inventory tracking on the variant | Supports common size/color combinations now while leaving a future structured option matrix open without changing the Product → Variant → SKU model                             |
| ADR-014 | Keep the product list at product-master grain and manage variants inside a dedicated product-detail view                                                        | Prevents size/color rows from overwhelming the catalog while preserving variant-level SKU, barcode, price, and stock controls                                                   |

## Decisions requiring owner confirmation before affected work

| ID      | Decision                                  | Recommended default                                 | Needed by                       |
| ------- | ----------------------------------------- | --------------------------------------------------- | ------------------------------- |
| ODR-001 | BIR accreditation scope                   | VAT-ready only; certification is a separate program | Reports/receipts implementation |
| ODR-002 | MVP live payment integrations             | Record external outcomes; no direct charging        | Checkout implementation         |
| ODR-003 | Automated subscription billing provider   | Manual/admin pilot first                            | Subscription automation         |
| ODR-004 | Durable offline POS                       | Defer until post-MVP                                | Offline module                  |
| ODR-005 | Pilot business and realistic data volumes | One representative multi-branch retail tenant       | Performance test planning       |

## Technical validations still required

- Run a vinext compatibility spike against the approved Next.js prototype.
- Select and benchmark the database query layer in Cloudflare Workers.
- Confirm local/staging/production Supabase workflow and pooling strategy.
- Confirm receipt-printer and barcode-scanner browser/device support on target hardware.
