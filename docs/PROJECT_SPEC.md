# PROJECT_SPEC.md

# HUSTLER CENTRAL SYSTEM (HCS)
## Functional Architecture & Requirements Specification — v1 LOCKED

## 1. Product Vision

HUSTLER CENTRAL SYSTEM (HCS) is a multi-tenant SaaS business operating system for SMEs, retailers, wholesalers, resellers, cafés, multi-branch businesses, and street hustlers.

HCS is not just a POS and inventory app. Its purpose is to help a business:

- SELL
- CONTROL
- PROTECT
- ANALYZE
- EXECUTE
- GROW

Core doctrine:

> ONE BUSINESS. ONE INVENTORY. ONE SALES TRUTH. ONE COMMAND CENTER. MANY CHANNELS. MANY BRANCHES.

The system should remain simple for small businesses while exposing more advanced workflows only when needed.

---

## 2. Core Product Principles

1. Multi-tenant SaaS architecture.
2. Tenant/company data must be strictly isolated.
3. POS and Back Office are separate applications.
4. One central backend/API serves all applications.
5. Inventory movements are ledger-based.
6. Financial/fund movements are ledger-based.
7. Completed financial and inventory records are not silently overwritten or deleted.
8. Reversals, corrections, cancellations, and deactivation are preferred over destructive deletion.
9. Feature availability is controlled by:
   - Platform feature availability
   - Tenant subscription entitlement
   - Tenant feature toggle
   - Employee permission
10. Complexity should only appear when the business actually needs it.
11. Basic business safety and traceability should not be paywalled.
12. Paid modules should primarily add automation, scale, integrations, customization, and deeper analytics.

---

## 3. Application Architecture

### Back Office

Domain:

`app.hustlercentral.com`

Purpose:

- Business management
- Inventory control
- Purchasing
- Finance
- Reports
- Employees
- Settings
- Ecommerce
- Approvals and alerts
- Audit and notifications

### POS

Domain:

`pos.hustlercentral.com`

Purpose:

- Employee PIN login
- Register opening/closing
- Sales
- Payments
- Refunds
- Returns
- Exchanges
- Cash management
- Manager approvals
- Operational exception handling

### API

Domain:

`api.hustlercentral.com`

Purpose:

- Shared central business logic
- Authentication
- Tenant enforcement
- Inventory engine
- Sales engine
- Finance engine
- Orders
- Approvals
- Audit
- Notifications
- Integrations

### HCS Super Admin

Separate protected platform application for HCS operators.

Must not be mixed with tenant Back Office.

---

## 4. Recommended Technical Architecture

Initial architecture:

- Modular Monolith
- TypeScript
- Next.js / React for Back Office and POS
- NestJS for API
- PostgreSQL
- Prisma
- Redis for queue/cache support
- S3-compatible object storage
- GitHub Actions
- Structured logging / Sentry
- Dev / Staging / Production environments

Suggested monorepo:

```text
apps/
  api/
  backoffice/
  pos/

packages/
  shared/
  ui/
  types/
  config/
```

Do not prematurely move to microservices.

---

## 5. Business Hierarchy

```text
HCS PLATFORM
  ↓
TENANT / COMPANY
  ↓
LOCATIONS
  ├── MAIN_STORE
  ├── STORE / BRANCH
  ├── WAREHOUSE
  ├── COMMISSARY
  └── FULFILLMENT_CENTER
      ↓
REGISTERS / POS DEVICES
```

Warehouse/commissary is optional.

A small business can use Main Branch as its receiving/replenishment source.

---

## 6. Authentication, Security, and Tenant Isolation

### Back Office

- Strong user authentication
- MFA can be added later
- Role and permission enforcement
- Tenant context comes from authenticated session, not request body

### POS

- Registered device
- Device linked to tenant/location/register
- Employee PIN login
- Manager PIN approval for sensitive actions

Request context should include:

- userId
- tenantId
- employeeId
- locationId
- permissions
- deviceId
- requestId

Recommended protections:

- PostgreSQL Row Level Security where practical
- App-layer tenant enforcement
- Never trust tenant_id supplied by client
- Strict tenant ownership on all transactional tables

---

## 7. Feature / Subscription Architecture

Feature state is layered:

```text
PLATFORM FEATURE AVAILABLE
  ↓
TENANT ENTITLED
  ↓
TENANT ENABLED
  ↓
EMPLOYEE PERMITTED
```

Do not hardcode plan names in core business logic.

Use feature entitlements / capability codes / limits.

Historical data remains available if a paid module expires.

---

## 8. Core Data Rules

### IDs

Use UUID or ULID internally.

Also provide human-readable references:

- Receipt number
- Order number
- Transfer number
- PO number
- Import job number

### Money

Use NUMERIC / DECIMAL.

Never use floating point for financial values.

### Time

Use TIMESTAMPTZ.

### Deletion

Financial, inventory, audit, and other important transactional records should not be hard-deleted.

Use:

- void
- reverse
- cancel
- deactivate
- supersede

---

# 9. INVENTORY ARCHITECTURE

## 9.1 Product Structure

```text
Product
  ↓
Variant
  ↓
SKU
  ↓
Barcode(s)
```

Rules:

- SKU unique per tenant
- Multiple barcodes allowed
- Product master shared across channels
- Stock is stored per location

## 9.2 Inventory Truth

```text
Inventory Balance
= Summary

Inventory Movement Ledger
= Truth
```

No feature directly edits inventory balances.

All stock changes must go through the Inventory Service.

Inventory concepts:

- on_hand
- reserved
- available
- in_transit
- damaged

Recommended:

`available = on_hand - reserved`

Compute rather than blindly store.

## 9.3 Inventory Movements

Examples:

- OPENING_BALANCE
- SALE
- REFUND
- PURCHASE_RECEIPT
- TRANSFER_OUT
- TRANSFER_IN
- DAMAGE
- ADJUSTMENT
- RETURN_TO_SUPPLIER

Every movement must contain:

- tenant
- location
- SKU
- quantity
- reason/type
- source reference
- actor/system
- timestamp

## 9.4 Costing

Default costing method:

**Moving Weighted Average Cost**

Historical sale COGS is snapshotted and never recalculated after later cost changes.

---

# 10. POS & REGISTER SYSTEM

## 10.1 Register Flow

```text
Employee PIN
  ↓
Open Register
  ↓
Opening Cash
  ↓
Sales / Expenses / Cash Movements
  ↓
Close Register
  ↓
Counted Cash
  ↓
Expected Cash
  ↓
Variance
  ↓
Approval / Alert if required
```

## 10.2 Cash Ledger

Movement types may include:

- Opening cash
- Cash sale
- Cash refund
- Cash in
- Cash out
- Shift expense
- Adjustment
- Register close variance

## 10.3 Register Rules

- Register and employee session are separate concepts.
- Clock In/Out is not Open/Close Register.
- Large variance can require manager approval.
- Register exceptions must be explicitly resolved.
- Never silently auto-close a problematic register.

---

# 11. SALES

Sales must snapshot:

- selling price
- discounts
- taxes
- cost
- COGS
- employee
- location
- register
- payment method

Do not recalculate old sale economics from current product data.

Returns/refunds/voids create linked reversal records.

Original sale remains available for history and audit.

---

# 12. CUSTOMERS & LOYALTY

## 12.1 Customers

Primary scope in v1:

**POS-originated customers**

Customer profile includes:

- Overview
- Purchase history
- Total spend
- Visit/order frequency
- Loyalty
- Returns/refunds
- Notes
- Activity

Support:

- Customer groups
- Resellers
- Customer-specific price lists

## 12.2 Loyalty

Loyalty is optional/toggleable.

Only POS sales earn loyalty in v1.

Marketplace purchases do not earn HCS loyalty.

Point balance is summary.

Point transaction ledger is truth.

Refunds must reverse earned points according to policy.

---

# 13. WHOLESALE

Two layers:

## 13.1 POS Wholesale

Sale channel remains POS.

Use `pricing_type` such as:

- Retail
- Wholesale
- Dealer

Threshold basis can be configured:

- Per SKU
- Per Product
- Per Pricing Group
- Whole Cart

Recommended default:

**Pricing Group**

When wholesale threshold is reached:

- HCS applies wholesale pricing automatically
- POS prompts to select/add reseller customer

Reseller status does not automatically bypass thresholds by default.

## 13.2 Advanced Wholesale

Paid module may include:

- Sales Orders
- Payment terms
- Partial fulfillment
- Receivables
- Credit limits
- Invoices
- Returns / credits

Branch restock is never treated as wholesale revenue.

---

# 14. PURCHASING & SUPPLIERS

## 14.1 Core Flow

```text
Supplier
  ↓
Purchase Order
  ↓
Goods Receipt
  ↓
Inventory Movement
```

PO alone does not increase inventory.

Only actual receiving creates inventory.

## 14.2 Central Receiving Model

Configurable:

- Default Central Receiving Location
- Default Branch Replenishment Source
- Allow Direct Supplier Receiving to Branches

For larger businesses:

```text
Supplier
  ↓
Warehouse / Commissary
  ↓
Branch Restock Request
  ↓
Allocation
  ↓
Transfer
  ↓
Branch
```

## 14.3 Receiving

Support:

- Partial receiving
- Damaged quantity
- Missing quantity
- Over-receiving
- Cost variance
- Supplier invoice
- Delivery receipt

Over-receiving can require manager approval.

## 14.4 Supplier Data

Supplier-product relationship may include:

- preferred supplier
- supplier SKU
- supplier cost
- MOQ
- lead time

Maintain purchase cost history.

Supplier returns are separate from stock adjustments.

---

# 15. TRANSFERS & RESTOCK

Distinguish:

- Restock Request
- Stock Transfer
- Purchase Order
- Inventory Movement

## 15.1 Branch Restock

```text
Branch Restock Request
  ↓
Configured Source
  ↓
Partial / Full Approval
  ↓
Stock Transfer
  ↓
Dispatch
  ↓
In Transit
  ↓
Receiving
```

## 15.2 Transfer Rules

- Internal transfers never create revenue.
- Source stock leaves sellable on_hand on dispatch.
- Stock becomes in_transit.
- Destination on_hand increases only after receiving.
- Transfer carries cost basis.
- Destination moving average cost recalculates.
- Cancel normally only before dispatch.
- Once in transit, resolve by receiving or return transfer.

## 15.3 Discrepancies

Support:

- Missing
- Damaged
- Wrong item
- Short quantity

Discrepancies may feed Alerts / Leak Protection.

---

# 16. ECOMMERCE / ORDER ENGINE

Each ecommerce channel is individually unlockable:

- Shopee
- TikTok Shop
- Online Store
- Future channels

All channels share one internal HCS Order Engine.

## 16.1 Internal Order States

- New
- Confirmed
- Reserved
- Picking
- Packed
- Ready to Ship
- Shipped
- Completed
- Cancelled
- Return / Refund

External marketplace status must also be stored separately.

## 16.2 SKU Mapping

External marketplace products/variants must map to internal HCS SKU.

Unknown/unmapped SKU:

- must be flagged
- must never be guessed
- reservation should be blocked until mapping exists

## 16.3 Inventory

Online order:

- reserve stock
- release reservation on cancellation
- deduct on fulfillment/completion according to workflow

Use idempotency by:

`channel + external_order_id`

## 16.4 Fulfillment

Fulfillment location configurable per channel.

Can be:

- centralized
- warehouse
- branch

---

# 17. MARKETPLACE SETTLEMENT MODEL

Critical distinction:

1. Order Value
2. Recognized Sales
3. Marketplace Deductions
4. Net Settlement / Cash Received

Order value is not the same as settlement.

Marketplace costs include:

- commission
- transaction fees
- affiliate fees
- shipping subsidies
- seller-funded voucher
- other deductions

Seller-funded and platform-funded discounts/subsidies must be tracked separately.

Concept:

```text
Order
  ↓
Completed / Eligible
  ↓
Recognized Sale
  ↓
Marketplace Receivable
  ↓
Fees / Deductions
  ↓
Expected Net Payout
  ↓
Actual Settlement
  ↓
Reconciliation
  ↓
Cash / Bank
```

Marketplace payout is not new sales.

Pending payout is Marketplace Receivable.

Settlement statuses:

- pending
- partially settled
- settled
- reconciliation required
- adjusted

Profit model:

```text
Gross Sales
- Seller-funded Discounts
- Returns / Refunds
= Net Sales

Net Sales
- COGS
= Gross Profit

Gross Profit
- Marketplace Variable Costs
= Contribution Profit

Contribution Profit
- Operating Expenses
= Estimated Net Profit
```

Physical fund allocation uses only actually settled cash.

Fallback if API settlement data is unavailable:

- Import marketplace CSV/XLSX
- Match using external order / settlement / reference IDs

---

# 18. FINANCE

## 18.1 Core Finance Structure

```text
Finance
├── Overview
├── Daily Business Close
├── Fund Allocation
├── Fund Accounts
├── Bank Accounts
├── Receivables
├── Marketplace Settlements
├── Expenses
├── Fund Ledger
├── Bank Reconciliation
└── Capital Health
```

## 18.2 Daily Business Close

Not the same as register close.

Business-day close consolidates:

- POS sales
- ecommerce sales
- wholesale sales
- COGS
- expenses
- settlements
- Gross Profit

Once closed:

- use adjustments/reversals
- do not silently rewrite history

## 18.3 Funds

Free/Core default:

- Capital / COGS Fund
- Operating Fund

Fund Account is a business accounting concept, separate from actual bank account.

Bank accounts can map to funds.

## 18.4 Fund Truth

```text
Fund Balance
= Summary

Fund Movement Ledger
= Truth
```

HCS may recommend allocation.

User confirms.

Initial versions should not automatically transfer real bank funds.

Expenses may specify fund source.

Advanced Finance can later support:

- custom funds
- tax reserve
- owner draw
- bank reconciliation
- inter-fund transfers
- advanced rules
- Capital Health

---

# 19. EMPLOYEES, TIME CLOCK & PERMISSIONS

## 19.1 Free/Core

- Employee records
- POS PIN
- Branch assignment
- Default roles
- Basic permission enforcement
- Activity history

Default roles:

- Owner
- Admin
- Manager
- Cashier
- Inventory Staff

## 19.2 Paid Optional

- Time Clock
- Custom roles
- Granular custom permissions

## 19.3 Time Clock

Supports:

- Clock In
- Clock Out
- Break Start
- Break End
- Attendance history
- Total hours

Time Clock is separate from Register Open/Close.

POS PIN may work without Back Office access.

Deactivated employees retain historical activity.

---

# 20. APPROVALS & ALERTS

## 20.1 Approvals

Approvals block an action until authorized.

Possible approval subjects:

- Refund
- Void
- Discount override
- Price override
- Cash out
- Expense
- Stock adjustment
- Transfer
- PO
- Register variance
- Fund allocation

Approval Center:

- Pending
- Approved
- Rejected

Manager PIN approval:

- applies only to the specific action
- must be audited

## 20.2 Alerts

Alerts represent conditions/problems.

Alert states:

- Open
- Acknowledged
- Resolved
- Dismissed

Categories may include:

- Cash/Register
- Inventory
- Sales
- Employee
- Expense
- Orders
- Finance
- System

Severity:

- Info
- Attention
- Warning
- Critical

Dashboard only surfaces high-priority actionable issues.

## 20.3 Advanced Controls

Paid may include:

- custom thresholds
- multi-level approvals
- remote approvals
- custom alert rules
- anomaly/risk detection
- leak analytics

Rule-based detection first.

AI/anomaly systems later.

---

# 21. AUDIT & ACTIVITY

Basic Audit is Free/Core.

Audit is append-only.

It cannot be casually edited or deleted.

Audit money, inventory, access, pricing, approvals, configuration, and other sensitive actions.

Audit event fields:

- actor
- actor type
- action
- tenant
- branch/location
- source/device
- timestamp
- reference
- before
- after
- reason

Actor types:

- USER
- SYSTEM
- INTEGRATION
- SUPPORT

Sensitive actions may require reason codes.

Audit feeds Risk/Alert systems but does not itself determine wrongdoing.

Employee Activity and entity timelines reuse the same audit foundation.

Historical audit remains after:

- employee deactivation
- role change
- subscription downgrade

Technical logs are separate from business audit logs.

---

# 22. NOTIFICATIONS CENTER

Notifications are the delivery layer.

Distinction:

```text
ALERT
= a condition/problem exists

APPROVAL
= an action is waiting for authorization

NOTIFICATION
= informs the relevant person
```

Core notification channels:

- In-app
- Email

Future:

- Push
- SMS

Recipient targets:

- Specific user
- Role
- Branch
- Tenant owner
- Request creator
- Approver

Reading a notification does not resolve an alert.

Core behavior:

- grouping
- deduplication
- read/unread
- notification history
- delivery status
- linked record

POS only receives role-appropriate operational notifications.

Paid advanced:

- scheduled digests
- custom notification rules
- automation/escalation
- SMS usage

---

# 23. FILE / ATTACHMENT HANDLING

One shared File Service.

Files are supporting evidence, not business truth.

Use S3-compatible object storage.

Database stores:

- file_id
- tenant_id
- storage_key
- original filename
- MIME type
- size
- uploader
- timestamp

Supported core use cases:

- Product images
- Expense receipts
- Supplier quotations
- Supplier invoices
- Delivery receipts
- Return/refund evidence
- Damage evidence
- Transfer evidence
- Approval attachments

Files are tenant-isolated.

Permissions inherit from parent record.

Finalized transaction evidence cannot be silently deleted.

Use:

- archive
- supersede
- version history where needed

Upload/change activity must be audited.

Optimize images using thumbnails/previews.

Paid can include:

- larger quotas
- bulk file export
- advanced retention
- global file search

---

# 24. IMPORT / EXPORT CENTER

## 24.1 Guided Import

Flow:

```text
Upload
  ↓
Select Import Type
  ↓
Map Columns
  ↓
Validate
  ↓
Preview
  ↓
Warnings / Errors
  ↓
Confirm
  ↓
Process
  ↓
Result
```

Supported core imports:

- Products
- Variants
- SKU / Barcode
- Categories
- Opening Inventory
- Customers
- Suppliers
- Price Lists

SKU is the primary product matching key.

Barcode may be secondary.

Do not match automatically by product name.

## 24.2 Opening Inventory

Opening stock import must create inventory ledger movements.

Never directly overwrite stock balances.

## 24.3 Validation

Examples:

- Duplicate SKU
- Duplicate barcode
- Missing required field
- Invalid price
- Invalid quantity
- Unknown category
- Unknown branch
- Invalid date

Errors and warnings are separate.

## 24.4 Import History

Store:

- job ID
- import type
- filename
- uploader
- row count
- created
- updated
- skipped
- failed
- timestamp

Large imports run asynchronously.

Use job tracking and idempotency.

## 24.5 Rollback

Safe rollback only.

For used records:

- deactivate instead of delete
- reverse inventory movements instead of deleting history

## 24.6 Export

Core export supports business data portability.

Formats:

- CSV
- XLSX where enabled

Paid advanced may include:

- saved mappings
- advanced bulk updates
- custom export columns
- scheduled exports
- migration assistants
- large-scale processing

---

# 25. ONBOARDING / SETUP WIZARD

Goal:

**READY TO SELL**

Flow:

```text
Create Account
  ↓
Create Business
  ↓
Main Location
  ↓
Business Setup Questions
  ↓
Feature Selection
  ↓
Products
  ↓
Opening Inventory
  ↓
Payment Methods
  ↓
Basic Fund Setup
  ↓
Employees
  ↓
Register
  ↓
POS Activation
  ↓
Guided/Test Sale
  ↓
Go Live
```

Principles:

- adaptive onboarding
- only show relevant features
- free/core setup must work without paid add-ons
- manual or CSV products
- manual or imported opening stock
- onboarding is resumable
- non-critical steps can be skipped
- remaining setup becomes post-launch checklist

Basic fund setup should introduce:

- Capital/COGS Fund
- Operating Fund

POS activation happens separately through POS app.

---

# 26. ERROR / EMPTY / RESTRICTED STATES

Standard UI states:

- EMPTY
- LOADING
- SUCCESS
- WARNING
- ERROR
- RESTRICTED
- LOCKED_FEATURE
- OFFLINE
- SYNCING
- PARTIAL_FAILURE
- ARCHIVED / INACTIVE

Core UX rule:

> Every blocked state should explain what happened, why it happened, whether the action succeeded, and what the user can do next.

Distinguish:

- feature not purchased
- feature entitled but disabled
- no permission
- missing configuration
- insufficient stock
- reserved stock
- register conflict
- failed payment
- pending payment
- offline
- syncing
- archived/inactive record

Critical transactions should be atomic.

Secondary failures must be separated from transaction success.

Example:

Sale completed successfully, email receipt failed.

Do not show generic dead-end errors.

POS error messaging should remain short and operational.

---

# 27. POS EXCEPTION FLOWS

## 27.1 Transaction Exceptions

Support:

- Void before payment
- Void after completion
- Full refund
- Partial refund
- Item-level refund
- Quantity-level refund
- Exchange
- Receipt reprint

Exchange should be modeled as:

```text
Return
+
New Sale
```

Completed sales are never deleted.

Use reversals.

## 27.2 Payment Exceptions

Support:

- Failed payment
- Pending payment
- Split payment
- Overpayment/change
- Wrong payment method correction

If payment status is unknown:

Do not say failed.

Use transaction/idempotency lookup.

## 27.3 Stock Exceptions

Support:

- Insufficient stock
- Reserved stock
- Unknown barcode
- Inactive product
- Missing price

Negative stock is blocked by default.

May be overrideable by policy/permission.

## 27.4 Register Exceptions

Support:

- Register already open
- Previous shift still open
- Cash variance
- Cash in
- Cash out
- Shift expense

## 27.5 Approval Exceptions

Support:

- Discount override
- Price override
- Refund threshold
- Void
- Cash out
- Variance

Manager approval is action-specific.

## 27.6 Connectivity

Support:

- Offline
- Syncing
- Unknown transaction status
- Duplicate submit
- Unsynced transaction
- Sync conflict

Use idempotency.

Offline/sync state must always remain visible.

## 27.7 Open Tickets

Optional feature.

Held/open ticket is not a completed sale.

Retail default:

Open ticket does not reserve stock.

Reservation behavior may be configurable later.

---

# 28. DASHBOARD / COMMAND CENTER

Dashboard is not a detailed report page.

It answers:

- How is the business doing?
- What is wrong?
- What needs attention?

Global filters:

- Date
- Location
- Channel

Business Pulse:

- Net Sales
- Gross Profit
- Estimated Net Profit
- Transactions
- COGS
- Expenses

Other areas:

- Sales Performance
- Needs Attention
- Branch Performance
- Inventory Health
- Register Status
- Fund Snapshot
- Expense Snapshot
- Product Performance
- Channel Performance
- Quick Actions

Dashboard content adapts to:

- enabled modules
- business size
- role
- permission

---

# 29. REPORTS

Dashboard and Reports are separate.

## Sales Reports

- Summary
- By Item
- By Category
- By Employee
- By Payment Type
- By Modifier
- Discounts
- Taxes
- Shifts
- Receipts

## Profitability

- Summary
- By Item
- By Category
- By Branch
- By Channel

## Inventory

- Stock on hand
- Available
- Reserved
- Valuation
- History
- Low stock
- Out of stock
- Slow/dead stock
- Adjustments
- Count variance
- Transfers
- Stock age

## Other

- Employees
- Ecommerce
- Finance
- Export

Free/Core:

- basic reports
- basic Gross Profit visibility
- basic CSV export

Paid Advanced:

- deep profitability
- advanced inventory analytics
- advanced branch comparisons
- marketplace economics
- saved reports
- scheduled reports
- custom export columns

---

# 30. BACK OFFICE FUNCTIONAL SITEMAP

```text
Back Office
├── Dashboard
├── Sales
├── Products
├── Inventory
├── Purchasing & Suppliers
├── Transfers & Restock
├── Customers
├── Loyalty
├── Wholesale
├── Ecommerce / Orders
├── Marketplace Finance
├── Employees
├── Approvals
├── Alerts
├── Finance
├── Reports
├── Audit & Activity
├── Notifications
├── Locations
├── Data / Tools
└── Settings
```

The final UI should not display every module at once.

Navigation should be adaptive based on:

- entitlement
- tenant toggle
- business configuration
- role
- permission

---

# 31. POS FUNCTIONAL SITEMAP

```text
POS
├── Employee PIN Login
├── Open Register
├── Opening Cash
├── Sell Screen
│   ├── Barcode Scan
│   ├── Product Search
│   ├── Categories
│   ├── Quantity
│   ├── Modifiers
│   ├── Discounts
│   ├── Customer
│   ├── Retail / Wholesale
│   └── Open Ticket
│
├── Checkout
│   ├── Cash
│   ├── E-wallet
│   ├── Card
│   ├── Split Payment
│   └── Receipt
│
├── Receipts
│   ├── Search
│   ├── Reprint
│   ├── Refund
│   ├── Return
│   ├── Exchange
│   └── Void
│
├── Cash Management
│   ├── Cash In
│   ├── Cash Out
│   └── Shift Expense
│
├── Manager Approval
└── Register Close
```

---

# 32. SUPER ADMIN / PLATFORM SIDE

Super Admin and Tenant Admin are separate security domains.

Main structure:

```text
HCS Super Admin
├── Platform Dashboard
├── Tenants
├── Subscriptions & Add-ons
├── Billing
├── Feature Management
├── Support Access
├── Platform Admins
├── Usage & Limits
├── System Health
├── Integration Health
├── Jobs / Queues
├── Incidents
├── Platform Audit
└── Announcements
```

Support access:

- requires reason/ticket
- fully audited
- read-only by default
- elevated support access requires stronger permission

Tenant historical data remains through:

- billing changes
- subscription downgrade
- suspension

Platform feature flag, tenant entitlement, and tenant toggle remain separate.

Add-ons can have:

- trials
- promotions
- temporary overrides

Tenant deletion is not a casual operation.

Sensitive payment credentials should remain with payment providers where possible.

---

# 33. NOTIFICATION / SUPPORT / PLATFORM OPERATIONS

Platform should monitor:

- API
- Database
- Redis
- Queue
- Object Storage
- Email
- Back Office
- POS
- Marketplace Connectors

Statuses:

- Healthy
- Degraded
- Incident

Monitor:

- API latency
- Error rate
- DB connections
- Failed jobs
- Queue backlog
- Sync failures

Jobs may include:

- Imports
- Exports
- Emails
- Notifications
- Marketplace sync
- Reports

Job states:

- Pending
- Processing
- Failed
- Retrying
- Dead Letter

---

# 34. SHARED PLATFORM SERVICES

```text
Shared Services
├── Authentication
├── Tenant Isolation
├── Authorization / Permissions
├── Feature Entitlements
├── Inventory Engine
├── Pricing Engine
├── Sales Engine
├── Order Engine
├── Approval Engine
├── Alert / Risk Engine
├── Finance / Fund Engine
├── Audit Engine
├── Notification Service
├── File Service
├── Import / Export Service
├── Marketplace Connectors
├── Device Authorization
├── Job / Queue Processing
├── Event Outbox
└── Reporting Layer
```

---

# 35. EVENT-DRIVEN INTERNAL ARCHITECTURE

Use internal domain events where useful.

Examples:

- SALE_COMPLETED
- ORDER_CREATED
- ORDER_CANCELLED
- ORDER_FULFILLED
- STOCK_RESERVED
- STOCK_RELEASED
- STOCK_MOVED
- TRANSFER_DISPATCHED
- TRANSFER_RECEIVED
- PURCHASE_RECEIVED
- REGISTER_OPENED
- REGISTER_CLOSED
- EXPENSE_RECORDED
- CASH_VARIANCE_DETECTED
- FUND_ALLOCATION_CONFIRMED

Use Transaction Outbox Pattern for reliable event publication.

Redis/queue is not the source of truth.

---

# 36. TRANSACTION SAFETY

Critical operations must be atomic.

Examples:

- Sale + stock movement + payment
- Refund + stock reversal + payment reversal
- Purchase receipt + stock movement
- Transfer dispatch + in-transit movement
- Transfer receive + destination movement
- Fund allocation + fund ledger entries

Use idempotency keys for:

- POS sale submission
- Payment submission
- Marketplace order ingest
- Transfer actions
- Import jobs
- External integration callbacks

Prevent accidental duplicate transactions.

---

# 37. ENGINEERING WORKFLOW

Recommended build workflow:

```text
SPEC
→ DATA MODEL
→ BUSINESS RULES
→ API CONTRACT
→ IMPLEMENT
→ UNIT TEST
→ INTEGRATION TEST
→ BASIC QA
→ FULL QA
→ TENANT ISOLATION TEST
→ REGRESSION TEST
→ COMMIT
→ STAGING
→ PRODUCTION
```

Do not test in production.

CI should include:

- lint
- typecheck
- unit tests
- integration tests
- build
- migration validation

Use:

- immutable migration history after production
- backups
- PITR
- restore testing

---

# 38. DATABASE MIGRATION ORDER — PROPOSED

```text
001_extensions
002_tenants
003_locations
004_users_employees
005_roles_permissions
006_subscription_features
007_catalog
008_pricing
009_inventory_core
010_registers_pos
011_sales_payments
012_returns_refunds
013_cash_expenses
014_fund_allocation
015_replenishment_transfers
016_audit_approvals
017_events_notifications
018_reporting_indexes
```

Likely core tables include:

- tenants
- locations
- users
- employees
- tenant_users
- roles
- permissions
- role_permissions
- user_roles
- features
- tenant_entitlements
- categories
- products
- product_variants
- product_barcodes
- inventory_balances
- inventory_movements
- inventory_reservations
- registers
- register_sessions
- sales_channels
- sales
- sale_items
- payment_methods
- payments
- cash_movements
- expense_categories
- expenses
- fund_accounts
- bank_accounts
- fund_bank_mappings
- business_day_closes
- fund_allocation_rules
- fund_allocations
- fund_movements
- fund_balances
- replenishment_requests
- replenishment_request_items
- stock_transfers
- stock_transfer_items
- suppliers
- purchase_orders
- goods_receipts
- ecommerce_orders
- ecommerce_order_items
- marketplace_sku_mappings
- sync_events
- audit_logs
- approval_requests
- approval_actions
- risk_alerts
- notifications
- event_outbox

---

# 39. FREE / CORE PHILOSOPHY

Free/Core should be capable of running a real small business.

Recommended Free/Core:

- POS
- Basic Sales
- Basic Inventory
- Products
- Basic Customers
- Optional Loyalty
- Basic Reports
- Basic Gross Profit
- Basic Audit
- Basic Alerts
- Basic Approvals
- Basic Notifications
- Basic Import/Export
- Basic File Attachments
- Capital/COGS Fund
- Operating Fund
- Basic Expenses
- Daily Business Close
- Basic employee roles
- POS PIN access

Paid modules may include:

- Advanced Inventory
- Warehouse
- Time Clock
- Custom Roles / Permissions
- Shopee
- TikTok Shop
- Online Store
- Advanced Wholesale
- Finance Pro
- Advanced Reporting
- Advanced Controls
- Advanced Audit Analytics
- Scheduled Digests
- SMS
- Advanced Data Tools
- Advanced Offline POS
- Advanced Open Tickets
- Advanced Leak/Fraud Analytics

---

# 40. FINAL LOCKED PRODUCT DOCTRINE

HCS must remain:

- simple for small operators
- scalable for multi-branch businesses
- strict about inventory truth
- strict about financial truth
- auditable
- permission-aware
- modular
- subscription-friendly
- integration-ready
- resilient to real-world POS exceptions
- adaptive rather than cluttered

Final doctrine:

> ONE BUSINESS. ONE INVENTORY. ONE SALES TRUTH. ONE COMMAND CENTER. MANY CHANNELS. MANY BRANCHES.

The next project phase after this specification is:

1. Information Architecture
2. Back Office navigation
3. POS navigation
4. Dashboard wireframe
5. Responsive behavior
6. Shared UI components
7. Visual design system
8. Detailed screen wireframes
9. API contracts
10. Data model implementation
