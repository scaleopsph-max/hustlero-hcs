# Reseller Portal Blueprint

Status: R1 source candidate on `codex/reseller-portal-r1`; not merged, migrated, or deployed

Date: 2026-10-29

Owner approval: `APPROVED RESELLER PORTAL BLUEPRINT - PROCEED R1` (2026-10-29)

## Purpose

Resellers order directly from an installable PWA (`apps/reseller`) instead of messaging the business. The portal is a new door into Advanced Wholesale, not a new system: every portal order is a `sales_orders` row on the same tenant, branch, product-variant inventory and the same credit, invoice, receivable and return controls. There is no second database, inventory pool or price source.

Goals: faster reseller ordering, inventory and profit tracked on the existing ledgers, visible order and logistics status, and visible available and sale items.

## Owner decisions (2026-10-29)

| Topic              | Decision                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Order confirmation | Auto-confirm when the order passes stock and credit checks; otherwise the order waits in the Back Office review queue. Owners can switch the portal to manual review. |
| Stock visibility   | Resellers see a badge only: In stock, Low stock (at or under the branch reorder level), Out of stock. Never quantities or cost.                                       |
| Payment            | GCash and bank transfer, recorded as the reseller's preference. The Back Office verifies payment with the existing wholesale payment references.                      |
| Couriers           | J&T and Lalamove. R2 records courier and tracking number manually.                                                                                                    |
| Signup             | Public application form; the Back Office approves before any access exists.                                                                                           |
| Points             | 1 point per ₱100. Assumed to use the invoice total after promo discount (R4, unconfirmed).                                                                            |

## R1 scope (this candidate)

- Feature `reseller_portal` (disabled by default, enabled by entitlement together with `advanced_wholesale`) and permission `reseller_portal.manage` for owners and the `owner`/`admin` roles.
- Public application form at `/apply?b=<tenant-slug>`. Duplicate pending applications for one email are acknowledged without revealing that one exists.
- Approval creates (or links) the reseller customer through `app.create_customer`, records explicit credit settings through `app.save_wholesale_customer_credit_settings`, assigns the price list, and creates an invited portal account. Existing reseller customers can be invited directly.
- Sign-in by email one-time code (works inside an installed PWA). The first sign-in with the invited, verified email links the Supabase user to the account.
- Catalog: assigned price list entries with reseller price, SRP (variant retail price), pricing-group minimum and stock badge at the portal fulfillment branch.
- Catalog cards are one per product (photo, variant count, price range, best stock badge, quantity in cart). A product with several variants opens a glass bottom sheet listing each variant with its own price, SRP, margin, minimum, stock badge and quantity; a single-variant product keeps its quantity controls on the card.
- Cart and checkout: wholesale minimum per pricing group, delivery address or branch pickup, GCash or bank transfer, notes, estimated reseller profit at SRP.
- Orders: status, review reason, rejection reason, lines, fulfilled quantities and invoices; reorder.
- Back Office `/reseller-portal`: settings, application decisions, review queue, accounts with suspend/restore and invitations.

## Locked behavior

### Submission and auto-confirmation

1. The verified Supabase user resolves to an active account, customer and tenant in the database. The `X-Tenant-Id` header is only a selector.
2. The command locks the reseller customer row (the same serialization used by Back Office credit commands), validates the price list and branch, generates the next `RP-000001` number, and snapshots lines at current reseller prices.
3. A pricing-group minimum that is not met rejects the request (`HCRP5`) so the reseller fixes the cart.
4. Holds are recorded, never raised, in this order: manual review setting, missing credit settings, unclassified historical invoices, insufficient available stock at the branch, then `open receivables + confirmed unfulfilled exposure + this order > credit limit`. This is the same exposure basis as `app.assert_wholesale_credit_capacity`.
5. With no hold, the order is confirmed in the same transaction: `inventory_balances.reserved` increases, reservation-ledger rows record the reseller account as actor, and the credit snapshot is written exactly as Back Office confirmation writes it.
6. With a hold, the order stays `submitted` with its `review_reason` and touches no inventory.

The credit limit caps confirmed orders that are not yet paid, including prepaid terms. A ₱0 limit therefore sends every portal order to review. This is existing Advanced Wholesale behavior and is shown on the approval form.

### Review

- Approve sets the order back to `draft` and calls the audited `app.confirm_wholesale_order` (or the credit-override variant) inside one transaction, so permission, current price refresh, minimums, stock and credit are rechecked. A failure rolls back and the order stays `submitted`.
- Reject cancels the order with a required reason that the reseller sees.
- Fulfillment, invoices, payments, returns and credit notes continue through the existing Advanced Wholesale screens unchanged.

### Data and security

- New private tables: `reseller_portal_settings`, `reseller_applications`, `reseller_accounts`, `reseller_order_counters`. RLS enabled; no table grants to browser or API roles.
- Additive changes: `sales_orders.source`, reseller creator, review reason and decision, fulfillment method, delivery address, payment preference, the `submitted` status; `sales_order_reservation_ledger.actor_reseller_account_id`. Each row records exactly one actor.
- Portal-originated audit events use `actor_type = 'system'` with `actorKind: 'reseller'` and the reseller account in metadata, because the audit reader recognizes only the existing actor types. A dedicated `reseller` actor type is follow-up work.
- The service worker caches only the public shell and hashed assets. Catalog, price and order responses are never cached because phones are often shared.

## Delivery plan

| Release | Scope                                                                                                                    | Gate                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| R1      | Applications, accounts, catalog with badges, cart, auto-confirm, review queue, order tracking                            | Staging UAT: a portal order reserves the same stock POS sees; held orders reserve nothing |
| R2      | Shipments: courier (J&T, Lalamove), tracking number, status timeline, proof of delivery (R2 storage), push notifications | Every delivered shipment reconciles with its invoice and inventory                        |
| R3      | Promotions with start/end dates and a Sale tab; SRP management; Reseller Sales & Profit and Logistics Status reports     | Promo snapshots and profit report verified in Staging                                     |
| R4      | Points from wholesale invoices (₱100 = 1 point), reversal on credit notes, rewards and redemption                        | Loyalty ledger reconciles after returns                                                   |

## Pay-first ordering (2026-10-30, ADR-042)

1. Checkout holds the stock for 4 hours; the order shows **Awaiting payment** with the deadline and **Where to pay**: the reseller picks GCash or Bank and sees that method's QR codes, account names and numbers (with copy), as set under **Payment accounts** in Back Office (up to 6 shown; QR images stored like product photos, kind `payment_qr`).
2. The reseller uploads a GCash or bank proof (a downpayment is fine). The order becomes **Payment sent** and appears under **Paid orders to confirm** in Back Office with its proofs.
3. The team checks the reference in GCash or the bank app and clicks **Verify payment & confirm order** (or **Reject order** with a reason, which releases the stock).
4. No proof within 4 hours: the order is cancelled automatically ("Payment was not received within 4 hours.") and the stock returns.
5. Balance payments on confirmed orders are verified one by one under **Balance payments to verify**. Payments are still recorded through Wholesale payments.
6. Confirmed orders move to the **Logistics** tab: To pack → Packed → Shipped (J&T, Lalamove or other, with tracking) → Delivered; pickup orders go Packed (ready for pickup) → Picked up. The reseller's order shows each step and the tracking number (ADR-043).

## Before Staging

- Create the `hustlero-hcs-reseller` Worker and set `RESELLER_ORIGIN` for the API and `NEXT_PUBLIC_RESELLER_PORTAL_URL` for the Back Office per environment.
- Enable Supabase email OTP and add `{{ .Token }}` to the Magic Link and Confirm signup templates (the portal accepts 6–10 digit codes; set Email OTP Length to 6 for the shortest code). Reseller sign-up must be allowed for OTP. Configure custom SMTP and raise the email rate limit: Supabase's built-in sender hit `429 email rate limit exceeded` after a few codes in Development (Development now sends through Gmail SMTP; Staging and Production should use a domain sender). Confirm rate limits for the public application endpoint at the edge.
- Apply the migration only through the normal environment-specific gate.
- Apply `20261030090000_reseller_portal_block_out_of_stock.sql`, `20261030120000_reseller_portal_pay_first.sql`, `20261030150000_reseller_payment_accounts.sql` `20261030180000_reseller_portal_logistics.sql`, `20261031090000_reseller_portal_report.sql` and `20261031120000_reseller_portal_fulfillment_payments.sql` (shipping completes the sale and records verified payments, ADR-045; each business needs active E-wallet and Bank Transfer payment methods), and deploy the API so its five-minute cron (development and staging only in `wrangler.jsonc`) sweeps expired payment holds. Add the production cron together with the production migration.
- Turning the portal on needs `advanced_wholesale` and `reseller_portal` both entitled and enabled. The Admin console can grant entitlements but no screen yet enables `reseller_portal` (owner feature selection does not list it); Development was enabled by an audited manual update on 2026-10-30. Add the owner/admin enable control before Staging.

## Open questions

- Points basis: invoice total after promo discount (assumed) or before.
- Whether managers should review portal orders by default (R1 grants owners and admins only).
