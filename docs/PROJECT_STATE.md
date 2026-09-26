# Project State

Last updated: 2026-09-26

## Phase

`PHASE 4 - CUSTOMERS, CONTROLS, AND REPORTING`

## Completed and verified

- GitHub repository created: `scaleopsph-max/hustlero-hcs`
- Repository intentionally remains public
- Local repository connected to `origin`; default local branch is `main`
- Supabase project created and renamed to `HUSTLERO (HCS)`
- Supabase development database is Healthy in Southeast Asia (Singapore)
- Cloudflare account authentication verified
- Existing Cloudflare applications were inspected and left untouched
- Development API Worker deployed at `https://hustlero-hcs-api-development.scaleopsph.workers.dev`; no production deployment exists
- Locked product specification reviewed
- Approved UI handoff reviewed; clean install, strict typecheck, and four application builds previously passed in an isolated review copy
- UI handoff dependency audit found critical/high issues in the legacy Next.js 14 dependency baseline; upgrade required before adoption
- Pre-development foundation documents created
- Blueprint approved by the owner with the required approval phrase
- Approved UI source imported into the monorepo
- Next.js upgraded from 14.2 to 16.3.5 and React upgraded to 19.3.0
- Four standard Next.js production builds verified
- Four vinext/Cloudflare production builds verified
- Worker-native Hono API skeleton, health contract, request IDs, and standard not-found envelope implemented
- Shared contracts and framework-independent domain packages created
- Formatting, lint, strict typecheck, Vitest, dependency audit, and CI workflow established
- Supabase CLI project initialized with explicit Data API opt-in behavior
- First private-schema tenancy migration and pgTAP foundation test versioned
- GitHub CI successfully completed a fresh Supabase start, database reset, migration, and all 14 pgTAP assertions
- Supabase JWKS access-token verification implemented for the API
- Protected `GET /v1/me` endpoint implemented with server-resolved tenant, branch, permission, and entitlement access
- Cloudflare Hyperdrive/PostgreSQL session-access repository implemented with parameterized SQL
- Supabase project confirmed to use an active asymmetric ECC P-256 JWT signing key
- Versioned no-login Hyperdrive and column-limited API context-reader database roles added with pgTAP coverage
- Both verified migrations applied to the Supabase development database and recorded in its internal migration ledger
- Dedicated `hcs_hyperdrive` login enabled with a generated credential; the credential is not stored in the repository
- Development Hyperdrive configuration `hustlero-hcs-dev` created with query caching disabled
- Development-only API Worker binding and Supabase URL configured; Cloudflare dry-run and TypeScript check passed
- Live development API smoke tests passed: `/health` returned 200; missing/invalid access tokens returned 401; a confirmed disposable Supabase Auth user received 200 with an empty tenant list through Hyperdrive
- Disposable smoke user deleted after verification; no Auth users or tenant data remain from the test
- Dependency audit reports zero known vulnerabilities
- Owner onboarding foundation implemented locally: atomic, idempotent tenant/main-location bootstrap command with owner role, audit event, and outbox event
- Protected `POST /v1/tenants` and owner-only `GET /v1/onboarding` implemented with shared contracts and unit tests
- Back Office `/setup` implements account sign-in/sign-up, business and main location creation, and a resumable setup checklist
- Local lint, TypeScript checks, unit tests, and standard production builds passed for this increment
- GitHub CI run `35691870052` passed full application checks and onboarding pgTAP assertions
- Onboarding migration applied to the Supabase development database and recorded as version `20260922054750`
- Development API Worker updated; live `/health` returned 200 and Back Office-origin CORS preflight returned 204
- Authenticated owner onboarding was completed in the development UI for `LOCAL RECIPE`; the business, one active main location, and one active owner were verified in the development database
- Business setup questions and feature selection are implemented end to end with private onboarding profiles, core feature catalog/entitlements, owner-only commands, audit/outbox events, shared contracts, and a resumable Back Office wizard
- GitHub CI run `35943955943` passed all application checks, a fresh database reset, and all 74 pgTAP assertions
- The business-profile and feature-selection migration was applied to development and recorded as version `20260924014406`
- Development API Worker version `7de03561-01a5-44ab-9e07-37462f7ee60c` is deployed; live `/health` returned 200
- The authenticated `LOCAL RECIPE` owner UI was verified on desktop and mobile layouts; Step 3 now presents the persisted business-question workflow
- Catalog foundation migration was applied to development and recorded as version `20260924025829`; private product tables have RLS enabled and direct Hyperdrive table reads are denied
- GitHub CI run `35949261791` passed application checks, a fresh Supabase reset, and the catalog pgTAP suite
- Catalog variant-management migration was applied to development and recorded as version `20260924054148`; later variants use tenant-safe, idempotent API commands with audit and outbox events
- Catalog product-editing migration was applied to development and recorded as version `20260924060133`; product-master edits keep variants intact
- Catalog variant-lifecycle migration was applied to development and recorded as version `20260924063914`; variant edits and soft deactivation are tenant-safe, idempotent, audited, and outbox-backed
- Variant removal preserves historical rows and blocks removal of the last active variant for a product
- Opening-inventory migration was applied to development and recorded as version `20260924101416`; private movement and balance tables use RLS and deny direct Worker table access
- Tenant-safe branch/variant opening inventory is implemented with integer-thousandth quantities, centavo costs, idempotency, append-only enforcement, audit, outbox, and atomic balance projection
- Inventory stock-visibility migration was applied to development and recorded as version `20260924105145`; branch-authorized stock and movement reads use private functions with pinned search paths and Hyperdrive-only execute grants
- Inventory adjustment migration was applied to development and recorded as version `20260924111023`; reasoned ADJUSTMENT movements update balances atomically with idempotency, audit, outbox, and negative-available guards
- Inventory approval migration was applied to development and recorded as version `20260924113821`; tenant owners can configure a quantity threshold, above-threshold adjustments remain pending without changing stock, and approve/reject decisions are tenant-safe, idempotent, audited, and outbox-backed
- Back Office `/approvals` now provides policy configuration and Pending/Approved/Rejected queues; inventory adjustment feedback distinguishes an immediate ledger entry from a request awaiting approval
- Live branch stock levels and movement history are implemented through private tenant-authorized database functions, API read contracts, and the Back Office Inventory views; the existing mock explorer has been removed
- Purchasing/receiving migration was applied to development and recorded as version `20260924120609`; suppliers, purchase orders, partial receiving, over-receive protection, inventory receipt movements, audit events, and outbox events are implemented
- Back Office `/purchasing` is connected to the authenticated API for supplier creation, draft PO creation, sending, and receipt posting
- Transfers foundation and retry-hardening migrations were applied to development as versions `20260924122319` and `20260924123317`; draft branch transfers, idempotent dispatch, in-transit balances, and idempotent partial/full receiving are implemented
- Back Office `/transfers` now provides the first branch transfer workflow for source/destination locations and active catalog variants
- Workforce migrations `20260924141108`, `20260924141519`, `20260924141803`, and `20260924142056` are applied; default staff roles and permissions, direct employee-role and branch assignments, bcrypt-hashed POS PINs, locations, registers, and idempotent owner commands are implemented for existing and future tenants
- Back Office `/employees`, `/locations`, and `/registers` are connected to the authenticated workforce API
- Register/payment migrations `20260924145650` and `20260924145806` are applied; tenant payment methods, one-open-session-per-register enforcement, immutable cash movements, supporting indexes, idempotent open/close commands, audit events, and outbox events are implemented
- Back Office `/payment-methods` and `/register-sessions` provide payment configuration, assigned-employee register opening, closing cash count, and variance visibility
- POS device migrations `20260925010256` and `20260925010400` are applied; device activation codes, device tokens, and employee session tokens are stored only as SHA-256 hashes, with private RLS-enabled tables and supporting indexes
- Back Office `/devices` creates 15-minute one-time activation codes for an active branch register and shows device activation/last-seen status
- POS `:3002` now requires device activation before employee sign-in; PIN authentication is branch-assignment aware, verifies the existing bcrypt credential, locks after five failed attempts for 15 minutes, and issues a 12-hour opaque employee session
- Development API Worker version `ec468fce-cec3-48bd-acbd-33c3b454d91c` is deployed with Back Office and POS local-origin CORS support
- Development API Worker version `5a415247-02aa-4bd2-baf9-1c9d49cbfe9b` is deployed with the live POS context, register-open, cash-sale, and Back Office sales endpoints
- POS cash-sales migrations `20260925022636` and `20260925022732` are applied; private sales, line, payment, and branch receipt-counter tables use RLS, deny direct Worker table access, and have supporting foreign-key indexes
- The live POS selling flow now loads its trusted employee/device/branch context, active catalog variants, branch availability, and payment methods from the API instead of mock data
- A POS employee can open only the activated device's register, with starting cash recorded in the immutable cash ledger
- Cash checkout is server-priced, atomic, and idempotent: sale, line snapshots, tender/change, inventory balance and `SALE` movement, `cash_sale` movement, audit event, outbox event, and branch daily receipt number commit together
- Back Office `/sales` lists completed tenant receipts with branch, register, cashier, item count, timestamp, and total
- The owner completed and verified the first live POS cash transaction: receipt `MAIN-20260925-000001` recorded ₱5,994.00 for six XL units, and branch stock moved from 10 to 4 with an immutable `SALE -6` movement
- Sales reversal migrations `20260925073433` and `20260925075533` are applied to development; refund headers/items and payment reversals are private, RLS-enabled, append-only, indexed for their foreign-key access paths, and inaccessible by direct Worker table reads
- Back Office sales rows open immutable receipt details with print layout, original payment snapshots, server-computed refundable quantities, partial/item refund controls, void controls, and reversal history
- Customer migrations `20260925082615` and `20260925142109` are applied to development; customer groups, counters, profiles, consent fields, and append-only notes are private, RLS-enabled, tenant-indexed, and inaccessible through direct Worker table reads
- Customer APIs support tenant search, create/update, profile activity, append-only notes, POS search/create, and atomic sale linkage with server-derived spend, visit, and refund history
- Back Office customer directory/detail screens and POS customer selection/quick-create are implemented and passed the local UI smoke test
- GitHub CI run `36147352776` passed formatting, lint, strict typecheck, 58 Vitest cases, all application builds, a fresh Supabase reset, and the customer pgTAP suite
- Development API Worker version `55928a9e-0ead-40e0-b531-27d6bba69922` is deployed with the customer and customer-linked-sale endpoints
- Post-migration Supabase advisor verification confirmed the five new customer foreign-key index findings are resolved; the private deny-all RLS design continues to produce the expected informational no-policy notices
- The owner verified the customer flow and customer-linked POS transaction result in development
- Loyalty migration `20260925150330` is applied to development; tenant policies default to disabled with no assumed earning rate, while accounts and transactions remain private, RLS-enabled, and ledger-driven
- Customer-linked POS sales earn points only when the owner enables a valid policy; retries do not double-earn, and partial/full refunds reverse points proportionally using the original sale-rate snapshot
- Back Office `/loyalty`, customer profile loyalty balance/activity, POS customer balances, checkout earning feedback, and receipt earned/reversed totals are implemented and visually smoke-tested
- GitHub CI run `36151218756` passed formatting, lint, strict typecheck, 59 Vitest cases, all application builds, a fresh Supabase reset, and all loyalty pgTAP assertions
- Development API Worker version `6a3b4501-344a-4ada-af97-c84f1b630f36` is deployed with loyalty policy, earning, balance, activity, and refund-reversal endpoints
- Post-migration Supabase advisors reported no new unindexed loyalty foreign keys; the expected private-schema no-policy notices and existing leaked-password warning remain tracked for hardening
- The owner completed and verified the controlled customer-linked loyalty earning and refund-reversal flow in development
- Reporting migration `20260926014136` is applied to development; `reports.read` is provisioned for owner, admin, and manager roles, while the tenant-authorized reporting projection is executable only through the restricted Hyperdrive database role
- Dashboard and Reports now use one timezone-aware reconciled projection for sales, refunds, COGS, gross profit, item/category/employee/payment summaries, branch performance, register status, and current inventory valuation; sales and inventory CSV exports are generated only from validated API data
- GitHub CI run `36209097197` passed formatting, lint, strict typecheck, 61 Vitest cases, all application builds, a fresh Supabase reset, and all 365 pgTAP assertions
- Development API Worker version `e6ee76e1-d000-4a3b-a658-2d5a4feec12d` is deployed with dashboard, sales-report, and inventory-report endpoints; live `/health` returned 200
- Authenticated Dashboard and Reports screens loaded reconciled development data successfully and passed desktop visual smoke testing with date, location, and channel filters available
- Post-reporting Supabase advisors found no reporting-specific table or index regression; expected private-schema no-policy notices, existing supporting-index follow-ups, and leaked-password protection remain tracked for hardening
- Alerts and Audit Activity migrations `20260926060528` and `20260926060944` are applied to development; alert records are private, RLS-enabled, non-deletable, and reachable only through tenant-authorized Hyperdrive functions
- Deterministic alert detection now covers out-of-stock tracked variants and closed register sessions with non-zero cash variance; low-stock remains intentionally unavailable until reorder points are configured
- Back Office `/alerts` provides Open/Acknowledged/Resolved/Dismissed queues and audited lifecycle actions; `/audit` provides date, branch, actor, and text filtering over append-only business events
- GitHub CI runs `36210806738` and `36222748443` passed full application checks, fresh Supabase resets, and the alert/audit pgTAP suite including supporting-index assertions
- Development API Worker version `877104a2-5e65-4840-8d14-93bd8100ab07` is deployed with alert and audit endpoints; live `/health` returned 200 and unauthenticated alert access returned 403
- Authenticated desktop smoke testing showed one genuine `LR-0001` out-of-stock alert and 29 tenant audit records; mobile testing at 390x844 verified the new compact header and dismissible navigation drawer
- Post-migration advisors confirmed all three new alert actor foreign-key index findings are resolved; expected private-schema no-policy notices, prior supporting-index follow-ups, and leaked-password protection remain tracked
- Basic Notifications migration `20260926064117` is applied to development; recipient-specific notification history is private, RLS-enabled, non-deletable, tenant-isolated, and reachable only through restricted Hyperdrive functions
- Alert and approval notifications are routed from server-owned records, deduplicated per recipient/source event, and keep read state independent from alert or approval lifecycle state; in-app delivery is explicit and email remains `not_configured` until a provider is selected
- Back Office `/notifications` now provides All/Unread views, individual and bulk read controls, linked-record navigation, delivery status, and a live unread badge in every page header
- GitHub CI run `36224291596` passed the complete application check, a fresh Supabase reset, and all database pgTAP suites including the 26 notification assertions
- Development API Worker version `80632818-a6a1-431a-8cb1-3bf6b37f1b8c` is deployed with notification read/history endpoints; live health returned 200 and unauthenticated notification access returned 403
- Authenticated desktop and 390x844 mobile smoke testing showed the genuine `LR-0001` notification with no horizontal overflow; the unread record was intentionally left unchanged
- Post-migration advisors found no notification-specific unindexed foreign keys; expected private-schema no-policy notices, prior supporting-index follow-ups, and leaked-password protection remain tracked
- Platform administration migration `20260926133441` is applied to development; the private platform-admin allowlist and actor-scoped idempotency ledger have RLS enabled, deny direct Worker table reads, and expose only restricted security-definer functions
- Platform API routes require a valid Supabase session at AAL2 before the database allowlist is checked; Super Admin and Operations may grant/revoke time-boxable tenant entitlements, while tenant suspension/reactivation remains Super Admin-only
- Entitlement revocation forces the tenant module off and tenant suspension blocks access without deleting historical tenant records; every committed platform operation requires a reason and appends a `platform_admin` audit event
- The separate Super Admin app at `:3003` now provides operator sign-in, TOTP enrollment/challenge, real tenant directory metrics, tenant search, entitlement controls, and reasoned suspend/reactivate confirmation flows
- GitHub CI run `36245448614` passed full application checks, a fresh Supabase reset, and the platform administration pgTAP suite including 38 new assertions
- Development API Worker version `a7f67531-9484-4651-b53b-4e66c1c7d1cb` is deployed; live health, unauthenticated platform rejection, and Admin-origin CORS smoke tests passed
- Post-migration advisors found no platform-specific unindexed foreign keys; private-schema no-policy notices are expected by the deny-all design, while leaked-password protection and prior supporting-index findings remain tracked

## Not started

- Remaining onboarding steps and go-live validation
- Non-cash and split tender implementation
- Cross-session cash refunds after the original register has closed
- Staging and production environments

## Current blockers/gates

- Docker-compatible runtime is not installed locally; database verification currently runs in GitHub CI
- vinext is beta; builds pass, while route classification remains reported as unknown for the current static pages

## In progress

- Owner completed the business-question and feature-selection forms for `LOCAL RECIPE`
- Manual catalog/product vertical slice: private Product → Variant → SKU → Barcode schema, tenant-safe/idempotent API commands, product-grain list, editable product detail, and nested add/edit/deactivate variant flow are implemented and verified in development
- Opening inventory per branch and variant is implemented and connected to the onboarding checklist; the authenticated `/inventory/opening` screen was verified with the saved `LOCAL RECIPE` catalog without mutating stock
- POS device activation, PIN session, and the first real cash sale were completed and verified by the owner
- Receipt detail/reprint and cash refund/void implementation is deployed and manually verified with a controlled partial refund: receipt `MAIN-20260925-000001` is partially refunded by PHP 999, net sales are PHP 4,995, and returned XL inventory increased from 4 to 5
- The first Main Register session was closed and reconciled successfully: PHP 1,000 opening cash, PHP 5,995 expected cash, PHP 5,995 counted cash, and zero variance
- Phase 4 customer profiles and sale linkage are deployed and owner-verified
- Loyalty earning and proportional refund reversal are deployed and owner-verified with a controlled customer-linked transaction
- Owner validation of reporting date/location/channel filters and both CSV exports remains
- Alerts and Audit Activity are deployed and visually verified; the owner acknowledgement is reflected in the live alert queue and its notification remains independently unread
- Basic Notifications are deployed and visually verified; email delivery awaits an owner-selected provider and remains truthfully marked `not_configured`
- Entitlements and the Basic Super Admin console are deployed to development; no account has been silently provisioned as a platform admin, so authenticated AAL2 operator validation remains pending owner confirmation of the exact account
- Supabase hardening follow-up: leaked-password protection and advisor-reported supporting indexes will be handled as dedicated security/performance work

## Next safe action

Confirm the exact Supabase account that should become the first `super_admin`, provision only that user in the private allowlist, enroll TOTP MFA through `http://localhost:3003`, and validate tenant/entitlement reads without changing live tenant access. Automated billing and support impersonation remain deferred.

## Production state

- Production URL: none
- Development API URL: `https://hustlero-hcs-api-development.scaleopsph.workers.dev`
- Production data: none
- Production deployment: none
- Rollback point: not applicable
