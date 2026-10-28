# Project State

October 28 PCOUNT continuation: source candidate adds whole-count approval,
current-policy recheck, guarded atomic variance posting and cancellation, plus
private list/action APIs. Recount currently requires cancelling the stale count
and creating a fresh count. Focused domain/contracts/API tests pass; disposable
database and multi-session validation, Back Office UI and release are pending.
Initial draft CI 40615847279 passed app checks but failed a test fixture query
that selected a variant from two different counts; the assertion now scopes
the count ID. No security assertion was relaxed and no hosted change occurred.

October 28 PCOUNT draft candidate on `codex/inventory-count-workflow`: owner
selected one whole-count approval when any variance exceeds the existing
threshold; approval does not post stock, and Owner/Manager posts separately.
Source adds strict contracts, pure role/variance helpers, local draft/count-entry
SQL and scoped API. 31 focused domain/contracts/API tests and API typecheck/lint
passed at this checkpoint. Database execution, concurrent/security QA, UI,
submission/approval/posting, stale recount and live deployment remain outstanding.
No stock posting function or hosted database change was performed.

October 28 inventory count continuation: local pure variance/staleness preview
implemented, with 11 focused tests and domain typecheck passed. No posting,
authorization, persistence, API, UI, migration or deployment yet. Owner and
Manager create/post; authorized staff count. Continue with the complete guarded
workflow and existing adjustment approval integration; see
qa/INVENTORY_COUNT_PREVIEW_2026-10-28.md. This checkpoint is uncommitted.

October 28 discounted-cash reversal integration source candidate: atomic original
snapshot net refunds/voids, guarded replay/current branch authority, cash/stock/
loyalty effects and immutable receipt breakdown implemented. Back Office uses
original-key/body session recovery and verified receipt history before clearing.
62 focused tests passed. Full local check and disposable SQL/concurrency/exact CI
pending at this checkpoint. Single-cash/open-original-register only; unsupported
tax, online/split payout, zero-cent and incoherent history remain denied. No hosted
action. See qa/POS_DISCOUNT_CASH_REVERSALS_2026-10-28.md.

October 28 next source increment: pure original-snapshot discounted-return
valuation added, with cumulative net-cent rounding and complete header/line/
history reconciliation. Payout and physical-quantity exhaustion are distinct;
zero-cent selections remain denied. No SQL/API/UI reversal guard was loosened.
Final full regression passed 1,424 app tests plus 47 simulated harness cases;
workspace-wide typechecks and lint passed, as did changed-source formatting.
See qa/RETAIL_DISCOUNT_RETURN_VALUATION_2026-10-28.md. Refund/void posting and
receipt/report integration remain next, not implemented by this pure helper.
No hosted action. Prior POS sale exact candidate 2c3a4ca passed both CI workflows.

POS retail discount sale source candidate: actual cashier authorization, server
net computation, immutable definition/line snapshots, online reference evidence
and original-command checkout recovery implemented for QA. 79 focused tests and
mocked desktop/mobile browser checks passed. Full local checks and isolated SQL/
concurrency/exact CI pending. Normal SQL checkout entry is unchanged. Discounted
refunds/voids and Back Office reports/detail remain gated and next. No hosted
action. See qa/POS_RETAIL_DISCOUNT_SALES_2026-10-27.md.

October 27 discount configuration source candidate: versioned definitions/private
API, dedicated permissions and Back Office manager with original-command recovery
implemented for QA. 55 API/helper and 13 DOM tests passed, mocked desktop/mobile
browser passed. Full local and isolated SQL/CI pending. No hosted action. POS
application/posting, discounted refunds and reporting remain next. See
qa/RETAIL_DISCOUNT_CONFIGURATION_2026-10-27.md.

October 27 retail discount computation checkpoint: owner resolved whole-ticket
scope, predefined-only dedicated manage/apply permissions, untaxed retail-only
eligibility and rejection of zero/negative payable. Pure quote engine and strict
configuration contracts added; 66 focused tests and shared-package typechecks
passed. Full local checks/all builds passed with 1,243 app tests / 64 files and
47 simulated harness cases; final contract tightening separately passed 24
contract tests/typecheck/lint. No new SQL schema or database execution. Database/API/
manager UI, POS authorization/posting, refund and report integration remain pending.
No hosted changes. See qa/RETAIL_DISCOUNT_COMPUTATION_2026-10-27.md.

October 27 closeout e6e6de0 passed both exact CI runs with 1,177 app tests / 62
files, 47 harness cases and 2,077 SQL assertions / 58 files, reset/concurrency/
cleanup. Result CSV, private/no-store reads, maximum-group review and primary
barcode preservation passed. Final source follow-up adds actual execution state
and committed counts to history; exact follow-up CI is pending. No hosted action.

October 27 execution baseline c6efe63 passed both exact CI runs, with 1,152 app
tests / 61 files, 47 harness cases and 2,062 SQL assertions / 58 files, reset,
concurrency and cleanup. Actual import posting is now implemented in source,
not hosted. Closeout adds fresh-authorized result CSV, private/no-store reads,
identity/FK guards and scale/barcode regressions; final closeout verification is
pending at this checkpoint. See qa/CATALOG_IMPORT_CLOSEOUT_2026-10-27.md.

October 27 next increment: catalog import confirmation, bounded atomic product-group
posting, durable outcomes and UI recovery are implemented for execution QA. At
this checkpoint 1,152 app tests / 61 files and 47 harness cases passed, along with
mocked desktop/mobile component checks; builds and isolated SQL CI remain pending.
See qa/CATALOG_IMPORT_EXECUTION_CANDIDATE_2026-10-27.md and
product/CATALOG_IMPORT_PROCESSING_2026-10-27.md. No hosted environment changed.

October 27 source continuation: durable catalog import prepared jobs/history and
cancel-only lifecycle implemented for QA, not posting. Original raw input and
server-derived plan are immutable; request-key recovery retains exact source.
Final full local/isolated CI verification pending at this document checkpoint.
See qa/CATALOG_IMPORT_JOBS_CANDIDATE_2026-10-27.md. No live environment changed.
Actual confirmation/bounded async posting and result reconciliation remain next,
then Discounts, PCOUNT and supplier improvements. Do not call the importer done.

## Current Priority: Catalog And Inventory Operations

October 26 owner approved five source development/QA slices with APPROVED
BLUEPRINT - PROCEED TO BUILD: Categories, catalog import, retail discounts,
PCOUNT and suppliers. Modifiers/Productions deferred. PCOUNT create/post is
Owner/Manager-only; other explicitly authorized staff may count. Dedicated entry
permissions and branch access must not be inferred from inventory.manage alone.
Discount ticket/use details were resolved October 27; see the checkpoint above.

Categories first candidate 0339684 passed both CI runs: 1,017 app / 47 harness,
1,953 SQL assertions / 55 files, six category concurrency cases plus existing
overlaps and cleanup. Draft PR #10, no merge or hosted action. Selected category
UUIDs replace free-text creation; referenced categories cannot archive.

Catalog import preview now has CSV template/parser, bounded SKU/parent/barcode/
category planning, authenticated API and guarded relevant snapshot, and UI with
per-row validation. Final full check passed 1,073 app / 47 harness and all builds;
focused planner/CSV/API/DOM/browser passed. Exact SQL CI pending at this document
checkpoint. No Import/Post action:
durable jobs, confirmation, asynchronous posting/results and write reconciliation
are next. Discounts, PCOUNT and supplier enhancements are not claimed built.
See qa/CATALOG_IMPORT_PREVIEW_CANDIDATE_2026-10-26.md. No live migration/deployment,
credential/access grant, main merge or policy bypass; frozen hosted runner unchanged.

## Current Priority: Combined AW3 And AW4 Source Closeout

October 26 owner clarified all remaining AW3/AW4 development/QA; Online Store last.
On codex/aw3-aw4-source-closeout from PR #7 d256339, integrated PR #8 frontend/
shared-UI fixes without merging either PR or changing frozen AW3 runner. Preserved
AW4 reversal code/error policy, fixed schema fixture mismatches and added combined
fund allocation/reversal/recovery DOM tests. Fixed corrupt-recovery controls and
an independently found P2 stale-completion storage race; red/green tests retained.
Independent bounded re-review: no remaining actionable finding; review is not
release approval. Added deferred Auth/history wait tests after reviewer noted gap.
Final full local check passed 980 app / 47 simulated harness cases and all builds;
exact source CI pending. Actual combined read-only returns/funds browser
desktop/mobile checks passed with mocked Auth/API. No SQL/API/domain/contract
definition/lockfile/workflow or hosted change. All 84 migration scripts unchanged.
See qa/AW3_AW4_SOURCE_CLOSEOUT.md for module inventory, evidence and release holds.

## Current Follow-Up: AW4 Computation Regression And Dependency Hardening

Owner requested next local development while hosted execution remains blocked.
On separate branch codex/aw4-computation-workflow-regressions from main 3df2c9f,
added six deterministic domain workflow tests (72 fractional histories / 150
payment-boundary sequences) and two oversized/exact-limit request contract tests.
Fresh audit found blocking Zod/Undici advisories; narrow pin/override/lockfile
correction passed clean installation and direct version checks. Full local checks
passed: 890 app / 47 simulated harness cases, all builds, dependency policy and
585-file secret scan. No financial production-source, migration,
authorization/security-policy or hosted changes. Exact CI remains pending at
this checkpoint; not merged/deployed. See
qa/AW4_COMPUTATION_WORKFLOW_REGRESSIONS.md. Online Store remains last.

Last updated: 2026-10-23

## Current Increment: Reviewed Source Integration Preparation

Owner approved source-only PR #5 merge after final review and passing CI. Remote
main remains e2437ad; previous AW4 head 8d1b8e7 passed both exact CI runs, including
882 app / 47 simulated harness cases and 1,922 combined-main SQL assertions.
October 23 fresh audit now blocks Next.js 16.3.8 on newly reported high/critical
advisories. All four app pins and the lockfile are updated to 16.4.2; no business
code, migration, permission or audit exception changes. Clean npm ci and direct
four-app version resolution confirmed 16.4.2. Fresh full local checks passed
(882 app / 47 simulated harness cases, all builds), dependency policy and staged
583-file secret scan. Exact updated-source CI remains required before merge.
Earlier CI is historical evidence, not acceptance of this dependency update.
See qa/AW4_SOURCE_INTEGRATION_2026-10-23.md. No hosted retry, token, migration,
deployment, financial command or Production change is authorized by source merge.

## Previous Increment: AW4 Fund Reversal And Original Valuation Extension

Owner approved full original-split fund reversal, independent per-fund liquidity
checks, separate refund, and original snapshot valuation for discounts/taxes and
0.001 quantities. Header-only amounts use approved proportional gross allocation,
stable line-ID order and cumulative cent rounding. Derived evidence is preserved
in credit-note lines. Online Store remains last. Local implementation and review
fixes passed the full local check (882 app / 47 simulated harness cases, complete
builds), dependency gate and 32 disposable PostgreSQL cases loading 84 scripts.
Exact-source fresh database/concurrency CI remains pending at this checkpoint;
no hosted release, credential or financial UAT is claimed. See
product/AW4_FUND_REVERSAL_VALUATION_EXTENSION.md.

The AW3 frozen release manifest and unresolved host execution restriction remain
separate. Do not combine new AW4 scripts with any earlier approved live batch.

## Historical Increment: Cross-Command Concurrency Verification

The loopback-only disposable CI concurrency harness now adds six independent-session orderings: payment-before-confirmation, confirmation-before-payment, opening-before-payment, unclassified-payment rejection before opening, cancellation-before-payment, and payment-before-cancellation. Customer locks are observed for serialized credit/opening commands; payment/cancellation are deliberately allowed to commute while the first transaction is still open. Assertions reconcile exact credit exposure, invoice balances, reservation releases, immutable opening counts, payment/allocation/audit/outbox uniqueness, and shared stock. A failed payment uses an outer customer lock and savepoint so the competing opening is demonstrably overlapping without recording money against unknown debt. No live connection is accepted.

JavaScript syntax and focused formatting passed. Full isolated CI execution is pending; Docker is not installed locally. The existing thirteen independent-session scenarios remain in the same harness, for nineteen total once executed. No new migration or live command was performed. The prior two UI increments are included in the candidate for full application and fresh-database verification.

## Previous increment: order-action approval selection and durable retry

Wholesale Orders now offers explicit optional credit approval selection for confirmation and regular fulfillment. Choices match the loaded order/customer/action and exclude expired, revoked or consumed approvals. No approval is selected by default, browser choice does not bypass the server's exact-excess check, and prepaid/COD payment mode clears/disables override selection. Regular fulfillment now shares the exact three-decimal reserved-remainder parser used by paid fulfillment rather than rounding arbitrary input.

Confirmation, regular fulfillment and paid fulfillment share one authenticated user/tenant-scoped pending command. Original operation, order, approval, quantities/payment, key and body survive reload. A dedicated retry remains available after the order changes state or the selected approval is consumed. New draft writes, cancellation and other actions are blocked while recovery is pending. Legacy paid-fulfillment records replay unchanged and are removed only after validated success/definite rejection; conflicting legacy/new records fail closed. Response order identity and fulfilled quantity are validated before clearing recovery.

Full local `npm run check` passed: tracked-file secret scan, formatting/lint/typechecks, 484 unit tests across 21 files, standard application builds, API dry run and Cloudflare builds. This includes 44 new action/selection/recovery cases. Synthetic desktop/mobile browser checks passed stale approval rejection unlocking, no default or wrong-scope approval, confirm/fulfill committed-lost-response reload/replay with identical key/body, consumed-approval and fully fulfilled order recovery, one confirmation/invoice, exact quantity rejection, paid-mode exclusion, unchanged legacy paid retry, read-only controls, no overflow and no page errors. Existing vinext notices remain non-failing build warnings. No new database/API changes, migration, push, live financial command or deployment.

Next: remaining cross-command concurrency tests (payment versus confirmation/opening and cancellation), complete isolated CI and Staging release/UAT. Separate Production approval remains required.

## Previous increment: credit-exception approval and revocation UI

Back Office `/wholesale/approvals/manage`, linked only for authorized approvers from approval history, connects the existing dedicated approval/revocation APIs. Order choices are scoped to authorized loaded orders and the selected confirm/fulfill action. Exact positive excess, explicit future local-time expiry, reason, and separate approval/revocation attestations are required. Revocation is append-only and does not remove consumed history. No tenant/customer/actor identifiers are sent in command bodies.

One pending command is stored under the authenticated user/tenant before POST. Reload retries preserve the original key, body, operation, and revocation target even when the approval is already revoked after a lost response. Permission/scope/unknown failures retain recovery; definite HCCO2/HCCO4/HCCO5 failures unlock editing. Response status and revocation ID are checked before recovery is cleared. Stale refresh results are removed, and read-only accounts receive no write controls.

Full local `npm run check` passed: tracked-file secret scanning, formatting, lint, typechecks, 440 unit cases across twenty files, standard application builds, API dry run and Cloudflare builds. This includes 39 new command-rule tests. Synthetic desktop/mobile browser checks passed exact money, independent attestations, approval/revocation lost-response replay, one record per command, already-revoked retry, definitive rejection unlocking, read-only controls, stale-result clearing/recovery, no horizontal overflow and no page errors. Dependency audit found no unaccepted high/critical advisories. Existing vinext chunk/static-classification notices remain non-failing build warnings. No database/API change, migration, live financial command, deployment, or push occurred.

Next: add approved-exception selection with durable confirmation/fulfillment retry identity, finish cross-command concurrency (payment versus confirmation/opening and cancellation), then complete isolated CI and Staging release/UAT. Production release still requires its separate gate.

## Previous increment: customer terms and explicit opening UI

Back Office `/wholesale/credit`, linked from Orders, now connects the existing authorized credit-settings and opening-receivable APIs. Active resellers have explicit payment terms, exact centavo credit limits, and reasoned revisions; unconfigured values remain blank rather than receiving invented defaults. Opening is owner-only, restricted to eligible unclassified legacy invoices, and requires a selected due date, reason, and explicit unpaid confirmation. Original invoice money remains server-derived; the UI sends no amount or tenant in either payload. No automatic opening posting or payment occurs.

One pending command is saved under the original user/tenant before POST. Unknown outcomes and authorization/scope errors retain the exact key/payload across reload, including an invoice now classified after a committed-but-lost response. Definitive validation/duplicate-classification rejection unlocks editing. Shared response checks require the pending customer/term/limit or invoice/due date to match before clearing recovery. Refresh clears stale results and preserves pending identity.

Local format/lint/typechecks and all 401 unit cases across nineteen files passed, including 44 new command/recovery rules. Synthetic desktop/mobile browser checks passed exact money, explicit terms, pre-POST validation, lost-response reload/replay for both commands, no duplicate revision/charge, classified-invoice recovery, read-only controls, and failed-refresh clearing/recovery. Local C: disk space was initially critically low, so full application build/security and disposable database verification will run in isolated CI before release. No Staging/Production command, migration, or deployment was executed.

Candidate `f9f664b42995fde655f992d139c7632919beb1ed` passed isolated CI `38142174465`: both jobs, dependency security, secret scanning across 429 tracked files, formatting/lint/typechecks, 401 unit cases, standard/Cloudflare builds and API dry run, fresh database reset, 1,204 pgTAP assertions across 35 files, thirteen independent-session scenarios, and cleanup. No new migration was required. Evidence: `docs/qa/AW3_CREDIT_OPENING_UI_CI_2026-10-11.md`. Local available disk space subsequently improved to over 38 GiB; the development server remains available on port 3001. No live environment changed.

## Previous increment: customer statements and aging

Migration `20261011050534` adds a private authorized read projection for scoped customer statements and receivables aging. Back Office `/wholesale/statements` adds as-of date/customer/location filters, invoice aging, charge/allocation entries, exact CSV export, unknown-classification warnings, and stale-result clearing on refresh failure. Due today remains current; branch business dates determine overdue bands. No debt, receipt, inventory, fund, or historical opening mutation is performed. Synthetic desktop/mobile browser checks passed filters, exact partial-payment balance, unknown warning, formula-safe CSV, read-only requests, failed-refresh clearing/recovery, and overflow/page errors. Full local `npm run check` passed with 357 unit cases across eighteen files, format/lint/typechecks, standard/Cloudflare builds, and API dry run. Post-staging secret scan passed across 424 files. Candidate `5996dae294d33d18b8c3772a4edd573b81dfbd02` passed isolated CI `38114238892`: both jobs, fresh database reset, 1,204 pgTAP assertions across 35 files, thirteen independent-session scenarios, and cleanup. Evidence: `docs/qa/AW3_STATEMENTS_AGING_CI_2026-10-11.md`. No live migration or deployment occurred.

## Previous increment: approval history

Verified candidate `6fddb741202d40124c5c5680e651a7951230cebc`, migration `20261011044216`, extends the authorized credit-override read model with server snapshot time, tenant-scoped order number, consumed/revoked/expired/approved status, and immutable exact consumption details. Back Office `/wholesale/approvals` is read-only with search, filters, refresh, and audit detail disclosure. Consumed history takes display precedence over later revocation/expiry; revocation metadata remains visible and no authorization rule changes. Synthetic browser checks passed four statuses, filters/search/empty results, exact used amount, retained revocation, failed-refresh stale-result clearing/recovery, GET-only requests, desktop/mobile overflow, and page errors. Full local checks and isolated CI `38112931956` passed: 330 unit tests, 1,181 pgTAP assertions across 35 files, thirteen independent-session scenarios, and cleanup. No live migration, approval command, payment, or deployment occurred.

## Current increment: atomic prepaid/COD fulfillment

Verified feature-branch candidate `d1cd3b537c1f1662f60182d08e0f053a351a6195`, migration `20261011035621`, adds exact full receipt per prepaid/COD delivery, atomic invoice/stock/payment allocation, immutable replay mapping, and Back Office pending-command recovery. Locked confirmation credit exposure remains unchanged; no separate inventory pool or automatic fund movement. Synthetic browser checks passed committed-lost-response reload/retry with the same key/body, definite mismatch unlock, read-only controls, and desktop/mobile overflow/page-error checks. Full local checks and isolated CI `38110566169` passed: 322 unit tests, 1,169 pgTAP assertions across 35 files, thirteen independent-session scenarios, and cleanup. Not yet a Staging/Production release. No real invoice, payment, Production secret, or live deployment changes in this increment.

## Phase

`PHASE 5 - HARDENING AND PILOT`

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
- Deterministic alert detection covers out-of-stock tracked variants, configured branch-variant low-stock thresholds, and closed register sessions with non-zero cash variance
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
- Support Access migrations `20260926142552` and `20260926143013` are applied to development; support grants are private, RLS-enabled, deletion-protected, fully indexed for their actor/tenant foreign keys, and inaccessible through direct Worker table reads
- Super Admin and Operations may now issue only self-scoped, read-only `tenant_overview` access for 15-120 minutes with a mandatory ticket and reason; overlapping active grants are rejected, expiry is automatic, revocation preserves history, and every successful overview load appends a tenant audit event
- The Super Admin app now has a separate Support Access workspace with tenant selection, ticket/reason/duration controls, personal grant history, immediate revoke, and a summary-only overview that excludes customer, receipt, credential, and record-level data
- GitHub CI run `36248532663` passed the complete application check, a fresh Supabase reset, and all database suites including 41 Support Access assertions
- Development API Worker version `a2c19580-a002-4247-bf69-7fe79a2df5ad` is deployed; health, unauthenticated rejection, Admin-origin CORS, authenticated empty support history, desktop rendering, and 390px mobile overflow checks passed without creating a live grant
- Post-migration advisors report no Support Access unindexed foreign keys; fresh supporting indexes are expected to remain unused until controlled grant activity begins, while private-schema no-policy notices and leaked-password protection remain tracked
- The owner designated `SCALEOPS PH` as the permanent platform test tenant. Controlled Support Access ticket `HCS-SUPPORT-VALIDATION-001` completed the live 15-minute grant, read-only overview, audit, and immediate revoke lifecycle; the grant history remains, all three lifecycle audit events exist exactly once, and zero active grants remain
- Subscription and add-on migrations `20260927000523`, `20260927000532`, and supporting-index migration `20260927001355` are applied to development. Dynamic plans, core/module composition, optional limits, manual trial/active assignment, and time-boxed grant-only overrides are private, RLS-enabled, idempotent, audited, and inaccessible through direct Worker table reads
- The Super Admin app now includes a Subscriptions & Add-ons workspace for plan creation, tenant assignment, and temporary override management. No live plan or tenant access change was created during read-only validation
- Remaining onboarding readiness now derives payment methods, basic funds, employees, registers, POS activation, and a completed sale from real records. Basic fund setup creates Capital and Operating accounts atomically while later money movement remains append-only
- GitHub CI run `36281715406` passed formatting, lint, strict typecheck, 77 Vitest cases, all application and Cloudflare builds, a fresh Supabase reset, and every pgTAP suite including the new 52 subscription and 28 onboarding assertions
- Development API Worker version `4a5b6d34-43ce-4b7c-a831-e143c1421d0c` is deployed; live health returned 200, unauthenticated subscription access returned 401, and Admin-origin CORS passed
- Desktop and 390px Admin checks rendered the empty plan catalog and all subscription controls without page-level horizontal overflow. Back Office go-live owner validation requires a fresh sign-in before any pending basic-fund action is submitted
- Post-migration advisors confirmed both new foreign-key supporting-index findings are resolved. New indexes are unused as expected before controlled activity; private-schema deny-all RLS notices and leaked-password protection remain tracked

## Not started

- Cross-session cash refunds after the original register has closed
- Production environment

## Current blockers/gates

- Docker-compatible runtime is not installed locally; database verification currently runs in GitHub CI
- vinext is beta; builds pass, while route classification remains reported as unknown for the current static pages

## In progress

- Advanced Wholesale blueprint approved by the owner with `APPROVED ADVANCED WHOLESALE BLUEPRINT - PROCEED AW1`. AW1 now includes tenant-private sales-order headers and lines, an append-only reservation ledger, draft/save/confirm/cancel commands, shared branch-variant inventory reservation, server-authoritative price and threshold revalidation, idempotency, audit/outbox records, API contracts/routes, and the Back Office `/wholesale` workspace.
- AW1 local verification passes: secret scan, formatting, lint, all workspace typechecks, all 93 Vitest tests, every standard production build, and every Cloudflare/vinext build completed successfully. The database suite contains 44 sales-order assertions plus owner-toggle regression coverage. Local pgTAP execution remains blocked because Docker/Podman is not installed; the complete suite remains enforced by GitHub CI.

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
- Entitlements and the Basic Super Admin console are deployed and owner-verified with MFA; the real two-tenant directory and eight available modules loaded without changing entitlement or tenant status, and platform access remains limited to explicitly owner-confirmed allowlist entries
- The owner-confirmed first platform account is provisioned as an active Super Admin; its account identifier remains outside the public repository, and TOTP enrollment plus authenticated read-only console validation succeeded
- Time-boxed read-only Support Access is deployed and live-validated against the owner-designated `SCALEOPS PH` test tenant; grant, overview view, audit, immediate revoke, and preserved-history behavior passed, while automatic expiry remains covered by the database regression suite
- Subscriptions & Add-ons and the remaining onboarding/go-live foundation are deployed. Owner-controlled validation remains before creating a first pilot plan, changing tenant access, or completing any pending basic-fund action
- The owner locked the inventory migration and cutover flow in ADR-037 and `docs/product/INVENTORY_MIGRATION_AND_CUTOVER.md`: product setup remains separate from previewed/idempotent opening-stock posting, reorder levels are branch-variant configuration, and POS go-live waits for reconciliation
- Branch-variant reorder levels, server-derived low-stock status, alert lifecycle, reporting counts/details, Inventory editing, and CSV output are implemented, deployed, and owner-validated end to end
- Reorder-level migrations `20260927080425` and `20260927080914` plus API Worker version `a7ce01ce-20e6-4040-9f44-cf290c779765` are deployed to development; CI runs `36304872151` and `36305132237` passed full application checks, fresh database resets, and all pgTAP suites, while live health and unauthenticated endpoint smoke tests returned 200 and 401 respectively
- Controlled validation against `SCALEOPS PH` changed `SAH-00001` from reorder level 5 to 10 and back to 5. Inventory status moved `in_stock -> low_stock -> in_stock`, report low-stock count moved `0 -> 1 -> 0`, the alert opened and automatically resolved, notification history remained preserved, and valuation stayed reconciled at PHP 6,200.00 for 10 available units. Post-migration advisors report no new unindexed reorder-policy foreign key.
- The Back Office sidebar business control is now a real authenticated tenant selector instead of a hardcoded prototype label. Its persisted selection is honored across Back Office workspaces and was browser-verified; the current account exposes only `SCALEOPS PH`.
- Inventory migration slice 2 is implemented and deployed: private RLS-enabled batch/row staging, idempotent tenant-authorized preview validation, SKU/barcode and branch resolution, duplicate detection, row-level errors/warnings, reconciled branch totals, downloadable CSV template/error rows, and a preview-only Opening Inventory UI.
- Inventory import migration `20260927131014` and API Worker version `feb56654-4a5b-40cc-b39a-94a6860516f5` are deployed to development. GitHub CI run `36321275116` passed the complete application check, a fresh Supabase reset, all database suites, and the 25 new inventory-import assertions; live health and unauthenticated preview smoke tests returned 200 and 401 respectively. Post-migration advisers found no new blocking security or performance issue; the private staging tables intentionally retain the established RLS-without-browser-policy posture.
- Core reporting views are complete in development: Sales, Payment Type, Discounts & Taxes, Inventory, and Shifts & Receipts share the same tenant-authorized date/location/channel scope and provide focused CSV exports. Shift reporting uses register-session opening business dates and reconciles immutable sales/refunds plus cash variance; receipts continue to open the immutable Sales archive.
- Reporting migration `20260927133224` and API Worker version `7ce46298-32f5-4587-afe9-7a3568590bb6` are deployed to development. GitHub CI run `36322556756` passed the full application check, fresh Supabase reset, and all pgTAP suites including the expanded 31-assertion reporting suite. Browser validation loaded all five report views, one live open shift, the PHP 6,200.00 inventory valuation, no page-level horizontal overflow, and no console errors.
- Inventory cutover posting and reconciliation are implemented end to end. A validated batch posts branch-variant opening balances, positive opening movements, reserved/damaged/in-transit quantities, and reorder policies atomically and idempotently; posted rows are immutable, and reconciliation must match quantity and valuation before the branch is eligible for POS sales.
- The POS API now exposes only the customer-aware gated sale command to the Hyperdrive role. Branches with a staged import require a reconciled batch, while pre-cutover development branches with existing inventory history remain compatible.
- Inventory cutover migration `20260928005534` and API Worker version `0c757775-9dac-4246-aaec-11009ce2e42b` are deployed to development. GitHub CI run `36363813826` passed the complete application check, fresh database reset, all pgTAP suites including 27 cutover assertions, 83 Vitest cases, and every standard and Cloudflare build. Live health returned 200 and unauthenticated posting returned 401.
- Post-cutover Supabase advisors found no new blocking issue or unindexed cutover foreign key. The established private-schema RLS-without-browser-policy notices, immediately-unused development indexes, leaked-password warning, and prior supporting-index backlog remain tracked for Phase 5.
- Supabase hardening follow-up: leaked-password protection and advisor-reported supporting indexes will be handled as dedicated security/performance work
- Controlled opening-inventory cutover validation passed against the permanent `SCALEOPS PH` test tenant. Batch `53c97505-8e61-46d8-89d9-227e4695c99f` accepted one fresh SKU, posted quantity 7 at PHP 50.00, reconciled PHP 350.00, preserved reserved/damaged/in-transit values and reorder level 3, emitted the expected audit/outbox events, and left the branch free of pending cutover blockers. Evidence is recorded in `docs/qa/INVENTORY_CUTOVER_VALIDATION_2026-09-28.md`.
- Phase 5 security and tenant-isolation audit completed for the current development scope. Live posture checks found RLS on all private business/platform tables, zero browser-role private-table DML, zero browser/public execution of private security-definer functions, and zero direct Hyperdrive private-table DML.
- Security hardening now requires explicit tenant selection for inventory post/reconcile commands used by multi-business accounts, shares one Supabase browser client across Back Office modules, runs a tracked-file secret scan in the main check, and runs a high-severity npm dependency audit in CI.
- Supabase advisors report only the established intentional private RLS-without-policy notices, one leaked-password-protection warning, and informational performance findings. Leaked-password protection remains an explicit owner-controlled pre-pilot gate. Full evidence is recorded in `docs/security/SECURITY_AND_TENANT_ISOLATION_AUDIT_2026-09-28.md`.
- GitHub CI run `36366081437` passed the high-severity dependency audit, tracked-file secret scan, formatting, lint, strict typecheck, 83 Vitest cases, all standard and Cloudflare builds, a fresh Supabase reset, and every pgTAP suite including the new 10-assertion security posture audit.
- Development API Worker version `52eb0a4a-03de-432e-97a0-42b4bd0dc8ef` is deployed with the multi-business cutover tenant-selection hardening. Live health returned 200 and unauthenticated inventory posting returned 401.
- Supabase plan verification confirmed that the `HUSTLERO (HCS)` organization is on `tier_free`. Leaked-password protection is available only on Pro and above, so the setting cannot be enabled truthfully on the current project and remains a pre-pilot plan gate.
- Staging readiness is documented in `docs/operations/STAGING_READINESS.md` with the provisioning order, environment configuration, UAT scope, release exit criteria, and explicit separation from production. No staging or production resource was created.
- GitHub CI run `36366648024` passed both the application verification job and the fresh Supabase migration/pgTAP database job after the hardening documentation update.
- Staging Supabase project `HUSTLERO HCS Staging` (`sdfwdhbryjyfufgtfqmf`) was created in Singapore at the confirmed $0/month project cost and reached `ACTIVE_HEALTHY`.
- The staging database was reset cleanly and all 46 committed migrations replayed with exact repository versions. Direct staging posture checks confirmed private-table RLS, zero browser/private-table DML, zero direct Hyperdrive table DML, restricted security-definer execution, the gated POS sale command, and 13 reviewed policies.
- Staging Hyperdrive `hustlero-hcs-staging` (`008f24430d3e433eb478caaa52787fea`) was created with a generated staging-only restricted login, SSL required, a 20-connection origin limit, and query caching disabled. The credential is not stored in the repository.
- The Supabase staging Auth dashboard independently confirms leaked-password protection is disabled and available only on Pro and above. This remains a pilot gate even though the new-project Security Advisor has not emitted the warning yet.
- Staging API Worker version `334918bb-c38c-4374-b3fa-31c9890a21dd` is deployed at `https://hustlero-hcs-api-staging.scaleopsph.workers.dev`; health returned 200, unauthenticated cutover posting returned 401, and the staging Back Office CORS preflight returned 204.
- Staging Back Office version `eefeb035-2dd1-4c36-a729-4ec68aba7818`, POS version `5cd5a760-199d-4f56-a2bd-3d412c7c5c83`, and Super Admin version `b969c720-9d84-482e-a9cf-a689cdc50ba9` are deployed at their isolated `*-staging.scaleopsph.workers.dev` URLs. All returned 200 and rendered the expected account, device-activation, and MFA sign-in entry states.
- Staging Supabase Auth uses the Back Office staging URL as its site URL and allowlists Back Office and Super Admin staging redirects. A vinext config-redirection quirk ignored `--env staging` during the first Back Office upload; the correct explicit staging deployment was completed and the newly created base-name Worker was deleted, leaving no production deployment.
- POS multi-tender payments are implemented for one to ten cash, e-wallet, bank-transfer, card-terminal, or other allocations. The server requires allocations to match its calculated total, permits change only on cash, records only the cash portion in the cash ledger, and blocks split/non-cash reversals until a dedicated payment-return allocation flow exists.
- Multi-tender migration `20260928140928` is applied to staging with the exact repository version; development records the same named migration as managed migration `20260929005458`. Direct checks in both environments confirmed the new Hyperdrive-only sale function, browser-role denial, receipt access, and removal of Hyperdrive execute access from the superseded signature.
- GitHub CI run `36502871749` passed the full application job and fresh-database migration/pgTAP job for the multi-tender candidate. Staging API Worker version `286f8d46-b29d-46de-8c27-22635a6cbb95` and POS version `ba723e6b-4146-4134-8af9-da0d43f9cdb2` are deployed; API health returned 200, unauthenticated checkout returned 401, POS-origin CORS returned 204, and the POS entry page returned 200.
- Post-migration Supabase advisors reported no new warning attributable to multi-tender payments. The established private-schema RLS-without-policy posture, supporting-index backlog, unused staging indexes, and development leaked-password warning remain tracked.
- Supabase Development `nlrzdgcxydmcvhushzwv` and Staging `sdfwdhbryjyfufgtfqmf` were transferred from the Free `HUSTLERO (HCS)` organization to the existing Pro `scaleopsph-max's Org` organization. Both remain `ACTIVE_HEALTHY` in Singapore with unchanged project references and database hosts.
- Pre/post-transfer checks matched the application-schema fingerprint and exact business/Auth/Storage row counts. Both environments retain the same ordered 47 migration names, and the live staging API, POS, Back Office, and Super Admin endpoints returned 200 after transfer; checkout authentication and CORS guards returned 401 and 204 respectively.
- Supabase reported an incremental compute cost of USD 10 per transferred project, approximately USD 20/month total. Transfer evidence is recorded in `docs/operations/SUPABASE_ORGANIZATION_TRANSFER_2026-09-29.md`.
- Leaked-password protection is enabled for the email provider in both transferred Pro projects. Fresh Development and Staging Security Advisor checks no longer report the leaked-password warning; only the expected informational private-schema RLS-without-browser-policy notices remain.
- The controlled Staging owner account is confirmed, its owner-controlled password recovery completed, and a fresh authenticated sign-in was verified on 2026-09-30. The Back Office loaded the `PABL0` tenant and its onboarding state; no credential is stored in the public repository.
- Staging Back Office version `90e26f9f-cc2b-40f2-ada8-cfafd9136277` adds the complete owner password-recovery flow: forgot-password request, expired-link guidance, recovery-session password confirmation, and return to sign-in after a successful update. The staging candidate contains zero Development Supabase/API references, passed Cloudflare dry run, and the deployed reset and expired-link screens were smoke-tested.
- Controlled owner UAT setup for `PABL0` now includes two inventory-tracked `P SHIRT` variants, immutable opening balances of 10 units each at PHP 499.00, two standard fund accounts, active cashier `EMP-001` assigned to Main Store with a hashed POS PIN, and active Main Register `REG-001`. Inventory balances, audit/outbox evidence, role and location assignments, and hashed credential storage were verified directly.
- Staging Back Office version `6c0e7192-74cb-4e8b-9b1f-82f9aa07fd1c` refreshes the Supabase session immediately before the sensitive POS activation-code command, preventing an overnight stale browser token from producing a false missing-business denial. The candidate contains zero Development references.
- The owner-confirmed `Front counter POS` activation completed against the isolated Staging POS on 2026-10-01. The device is active for Main Store / Main Register, the one-time activation hash and expiry were cleared, a valid SHA-256 device-token hash is stored, and exactly one activation audit event exists. No raw activation code or device token is recorded in the repository.
- The owner-confirmed staging cashier sign-in for `EMP-001` completed on `Front counter POS`. The resulting employee session is active and unexpired, its credential is stored only as a valid SHA-256 hash, failed PIN attempts remain zero, the credential is unlocked, and exactly one session-start audit event exists. The POS is waiting for Main Register opening cash before the guided sale.
- The owner-confirmed Staging Main Register opening completed with PHP 1,000.00 generated starting cash. Exactly one register session is open for `EMP-001`, with one matching immutable opening-cash movement and one `register.opened` audit event. The POS catalog shows both generated `P SHIRT` variants with 10 units available each and is ready for the guided sale.
- The owner-confirmed guided Staging POS sale completed as receipt `MAIN-20261001-000001`: one `P-00001` unit at PHP 999.00, PHP 1,000.00 cash tendered, and PHP 1.00 change. The completed sale, payment, decrement to 9 units on hand, cash movement, audit event, and outbox event each exist exactly once. Sales and Reports UIs show one transaction, PHP 999.00 net sales, PHP 499.00 COGS, PHP 500.00 gross profit, and the correct immutable receipt detail.
- The Staging Main Register was closed and reconciled with PHP 1,999.00 expected and counted cash, zero variance, no variance movement, and exactly one close audit and outbox event. The Shifts & Receipts UI reports one closed session, zero exceptions, one transaction, PHP 999.00 net sales, and zero variance. Consolidated evidence is recorded in `docs/qa/STAGING_GUIDED_POS_UAT_2026-10-01.md`.
- The Staging Back Office sidebar location-count defect is resolved. The summary had incorrectly used the authenticated employee's assigned-location authorization scope, which is empty for an owner without an employee record, instead of the tenant's active-location total. `/v1/me` now returns an independently derived `locationCount`; regression coverage confirms an owner with no employee location assignments still sees the correct business total.
- API Worker version `1f099099-8a16-4203-9b7d-610e99c9885a` and Back Office Worker version `e61b47e8-a317-4281-bfc8-fdc7402d6781` contain the fix. Full `npm run check`, deployment dry runs, API health/auth/CORS smoke tests, and authenticated browser validation passed. The sidebar selector and expanded business menu both show `PABL0 / 1 location`, while the Locations page still shows Main Store and Main Register.
- Controlled Staging same-session cash refund UAT passed for receipt `MAIN-20261001-000002`. One P-00001 sale and its PHP 999.00 full refund each posted exactly once; stock moved `9 -> 8 -> 9`, session cash returned to PHP 1,000.00, sales and payment reports reconciled, and the register closed at PHP 1,000.00 expected/count with zero variance. Refund, payment reversal, inventory movement, cash movement, audit, outbox, and register-close evidence is recorded in `docs/qa/STAGING_REFUND_UAT_2026-10-01.md`.
- The supported refund boundary was confirmed: the original register session must remain open. The closed-session receipt correctly blocks reversal, and cross-session cash refunds remain not started.
- Controlled Staging purchasing and receiving UAT passed for `PO-UAT-20261001-001`. One generated supplier, one PHP 900.00 PO line, send transition, and full goods receipt each posted exactly once. P-00002 stock moved `10 -> 12`, its weighted average cost moved `PHP 499.00 -> PHP 490.83`, total inventory valuation reconciled at PHP 10,380.96, and all supplier/PO/receipt audit and outbox records matched. Evidence is recorded in `docs/qa/STAGING_PURCHASING_UAT_2026-10-01.md`.
- Controlled Staging branch-transfer UAT passed for `TR-UAT-20261001-001`. Dispatch moved two P-00002 units from Main Store into destination transit; receipt posted them to generated `UAT Branch 2`, leaving source 10, destination 2, transit zero, and combined inventory unchanged at 12. Average cost remained PHP 490.83 at both branches, total valuation stayed PHP 10,380.96, all transfer audit/outbox records matched, and the destination out-of-stock alert automatically resolved while notification history remained preserved. Evidence is recorded in `docs/qa/STAGING_TRANSFER_UAT_2026-10-01.md`.
- Controlled Staging customer and loyalty UAT passed for generated customer `CUST-000001` and receipt `MAIN-20261002-000001`. The customer-linked PHP 999.00 cash sale earned 9 points at the exact PHP 100.00 rate; its same-session full refund appended a `-9` reversal, restored P-00001 stock to 9, returned customer net spend and point balance to zero, and left one retained visit. The register closed at PHP 1,000.00 expected/count with zero variance, and all sale, customer-link, loyalty, refund, register, audit, and outbox evidence reconciled exactly once. Evidence is recorded in `docs/qa/STAGING_CUSTOMER_LOYALTY_UAT_2026-10-02.md`.
- The owner-confirmed existing Staging owner identity is provisioned as the single active `super_admin` allowlist entry. Its tenant-owner membership remains active and unchanged, and isolated Super Admin sign-in plus TOTP enrollment now reach a verified AAL2 session.
- Controlled Staging subscription and support-access UAT passed through the MFA-gated Super Admin app. Generated plan `HUSTLERO Pilot Full` (`pilot-full`) includes all 8 available modules and is actively assigned to `PABL0`; all 8 entitlements remain enabled. Ticket `UAT-20261002-001` granted only read-only `tenant_overview` access, produced one audited aggregate overview view, and was immediately revoked, leaving zero active support grants. Plan creation, assignment, grant, view, and revoke audit events each exist exactly once. Evidence is recorded in `docs/qa/STAGING_SUBSCRIPTION_SUPPORT_UAT_2026-10-02.md`.
- Controlled Staging Worker rollback passed. API version `286f8d46-b29d-46de-8c27-22635a6cbb95` briefly received 100% traffic and passed health 200, unauthenticated `/v1/me` 401, and Back Office CORS 204; release-candidate version `1f099099-8a16-4203-9b7d-610e99c9885a` was then restored to 100% traffic and passed the same checks.
- Supabase physical-backup recovery passed from backup `2026-10-01 16:03:50+00` into isolated project `HUSTLERO HCS Recovery Drill 2026-10-02` (`fliglpvhqtkstpnczfnq`). The recovered project reached `ACTIVE_HEALTHY`; all 47 migrations, schema counts, Auth-user count, RLS posture, constraints, 57 timestamped business-table counts at the recovery point, tenant ownership, inventory, sales, payments, refunds, register, audit, and outbox checks reconciled. Evidence is recorded in `docs/qa/STAGING_RECOVERY_DRILL_2026-10-02.md`.
- The owner explicitly confirmed recovery-drill cleanup. Supabase successfully deleted isolated project `fliglpvhqtkstpnczfnq`, and the Pro organization returned to its four original projects without changing Staging.
- Final release verification passed on 2026-10-02: tracked-file secret scan, formatting, lint, strict typecheck, 85 Vitest cases, all standard builds, and all Cloudflare builds completed successfully. Staging remained `ACTIVE_HEALTHY`; Security Advisor returned only the established informational private-schema notices; API health/auth/CORS returned 200/401/204; and API release-candidate version `1f099099-8a16-4203-9b7d-610e99c9885a` remains at 100% traffic.
- The owner approved the Staging release candidate for Production foundation provisioning. The isolated `HUSTLERO HCS Production` Supabase project (`gmprhuzbisfylidjpfob`) is active in Singapore and all 47 committed migrations are recorded as applied.
- Production database posture verification found 67 business tables with RLS enabled, 13 explicit policies, and 130 routines. The only unvalidated constraint belongs to the Supabase-managed Realtime schema; no application-schema constraint is left unvalidated.
- Production Hyperdrive `hustlero-hcs-production` (`a611fc9b39974b59a887529621440b6c`) uses a dedicated restricted login, SSL required, 20 origin connections, and caching disabled. The generated credential was rotated immediately after terminal-title exposure and is not stored in the repository.
- Production API Worker version `180681b0-d9f2-4c2c-8b9b-38241c0f2cb1` is deployed at `https://hustlero-hcs-api.scaleopsph.workers.dev`; health, unauthenticated access rejection, and Back Office/POS CORS smoke checks returned 200/401/204.
- Production Back Office version `afaf999e-7c52-4500-bf0a-3d22165c390b`, POS version `c4f70120-2818-4ce8-8a27-2d56528796a8`, and Super Admin version `84603dd8-2346-4103-92ff-d5fe99d19457` are deployed and returned 200 from their production Workers URLs. Generated bundles contain the Production API and Supabase references and no Development or Staging references.
- Production Supabase Auth uses the active asymmetric ECC P-256 signing key. The Back Office site URL and Back Office/Super Admin wildcard redirects are saved, leaked-password protection is enabled, and the fresh Security Advisor result contains only the 57 expected informational private-schema no-policy notices.
- The owner-confirmed Production identity is active and the first controlled tenant, `SAH RESTORATION`, was bootstrapped with one active owner and `Main Store / MAIN`. Its canonical slug is `sah-restoration`.
- Initial Production onboarding exposed a form defect where auto-slug generation stopped after the first business-name keystroke. The duplicated leading character was corrected atomically with one audit and one outbox event, regression coverage was added, and Production Back Office version `81742123-7a31-41af-bedb-7d8cdc30faed` passed build isolation, dry-run deployment, HTTP 200, and authenticated setup-state checks.
- The controlled Production tenant profile and all 8 currently deployed feature entitlements are configured. Catalog bootstrap contains `SAH SOCKS V1 / WHITE` (`SAH-00001`) at PHP 499.00 retail and PHP 250.00 unit cost, with an immutable 100-unit Main Store opening balance. The Capital/COGS and Operating fund accounts are active with zero balances.
- Production workforce and register bootstrap contains active cashier `EMP-001` assigned to Main Store, active `Main Register / REG-001`, and one active `Front counter POS`. The first unused activation code expired and its device record was safely revoked before a fresh one-time code activated the current device; no raw PIN, activation code, or device token is recorded.
- The owner-confirmed Production guided sale completed as receipt `MAIN-20261003-000001`: one `SAH-00001` unit at PHP 499.00, PHP 500.00 tendered, and PHP 1.00 change. Stock moved `100 -> 99`, the register cash ledger moved `PHP 1,000.00 -> PHP 1,499.00`, and the sale, payment, inventory movement, cash movement, audit, and outbox records each exist exactly once. Evidence is recorded in `docs/qa/PRODUCTION_GUIDED_POS_UAT_2026-10-03.md`.
- The owner-confirmed same-session full refund for `MAIN-20261003-000001` completed with return-to-stock enabled. The receipt is `refunded`, stock restored `99 -> 100`, register cash returned `PHP 1,499.00 -> PHP 1,000.00`, and the refund, payment reversal, inventory movement, cash movement, audit, and outbox records each exist exactly once.
- The owner-confirmed Production Main Register close completed with PHP 1,000.00 expected and counted cash, PHP 0.00 variance, no variance movement, one close audit event, one close outbox event, and zero open register sessions. Reports show one closed session, zero open sessions, zero exceptions, and PHP 0.00 net sales after the full refund. Evidence is recorded in `docs/qa/PRODUCTION_GUIDED_POS_UAT_2026-10-03.md`.
- Production release smoke validation after the controlled UAT returned API health 200, unauthenticated `/v1/me` 401, Back Office-origin CORS 204, Back Office 200, and POS 200. Wrangler deployment inventory shows only one listed version for Production API, POS, and Super Admin; Back Office has an older version, but there is no matching previous full-stack release set for a safe traffic-switch rollback drill. No Production traffic was switched.
- The owner approved the documented single-version rollback exception. Final go-live review passed: Production is `ACTIVE_HEALTHY`, all 47 migrations are present, Security Advisor reports only the established 57 informational private-schema notices, the tracked-file secret scan passes, and the controlled transaction state is fully reversed with a balanced closed register. Technical readiness is complete; owner go-live approval remains the only release decision.
- The owner approved `HUSTLERO PRODUCTION GO-LIVE FOR SAH RESTORATION` on 2026-10-03. Production is now approved for live pilot operations; the controlled UAT sale/refund remains retained as immutable audit evidence.
- The first live operating shift was intentionally opened with PHP 1,000.00 starting cash. The owner-confirmed live sale `MAIN-20261003-000002` completed for five `SAH-00001` units at PHP 2,495.00 cash tendered from PHP 2,500.00, with PHP 5.00 change. Stock moved `100 -> 95`, the cash ledger recorded one PHP 2,495.00 `cash_sale` movement, and sale, audit, and outbox records each exist exactly once. The shift then closed at PHP 3,495.00 expected and counted cash with zero variance, no variance movement, and one close audit/outbox pair. Evidence is recorded in `docs/qa/PRODUCTION_LIVE_PILOT_2026-10-03.md`.
- The owner approved the Production Basic Wholesale release. Migration `20261003055709` is recorded as the 48th Production migration; the Security Advisor has no warning- or error-level findings and the Performance Advisor has no error-level findings. Production API `5c82d179-84bb-4145-8055-bd826da7cfaa`, Back Office `a8753db5-c0c1-4e93-8091-3ffd78f2dadc`, and POS `9ea9e392-1e58-4de7-80e7-55492b62c032` are deployed with Production-only references. Health/auth/CORS/page checks returned 200/401/204/200, and the authenticated owner session loaded the new Wholesale Pricing workspace for `SAH RESTORATION`. No Production price list, sale, or inventory movement was created during deployment. The temporary Supabase CLI token was revoked and the account token list was verified empty. Evidence is recorded in `docs/qa/PRODUCTION_WHOLESALE_RELEASE_2026-10-05.md`.
- Production Basic Wholesale activation and controlled UAT passed. Active Wholesale pricing requires 10 units at PHP 450.00 each; active Dealer pricing requires 50 units at PHP 399.00 each. Reseller gating and sub-threshold Charge blocking were verified. Exact-cash receipts `MAIN-20261005-000001` (PHP 4,500.00) and `MAIN-20261005-000002` (PHP 19,950.00) each posted once and were fully refunded with return-to-stock enabled. Shared inventory returned to 95 on hand and available, customer net spend returned to PHP 0.00, and both append-only reversal histories are preserved. On 2026-10-06 the owner supplied the PHP 1,000.00 physical count; the Main Register closed at PHP 1,000.00 expected and counted cash with zero variance, leaving zero open sessions. Evidence is recorded in `docs/qa/PRODUCTION_WHOLESALE_UAT_2026-10-05.md`.
- Advanced Wholesale AW1 branch CI run `37552554435` passed the fail-closed dependency gate, tracked-file secret scan, formatting, lint, strict typecheck, all 93 Vitest cases, all standard and Cloudflare builds, a fresh Supabase reset, and every pgTAP suite including the 44-assertion sales-order and shared-inventory reservation coverage.
- Staging migrations `20261005233310_advanced_wholesale_sales_orders` and `20261007043637_advanced_wholesale_tenant_toggle` are recorded in the exact migration ledger. The toggle follow-up preserves the locked four-layer access model by exposing an entitled add-on in owner feature choices without auto-enabling it.
- Staging API Worker `983b06b6-fe0d-43ae-ba7c-0d8179823848` and Back Office Worker `64d5c1c6-6715-4bb2-aed5-52e5650a4fc6` are deployed with staging-only references. Health, auth guard, CORS, `/wholesale`, and authenticated setup loading passed.
- PABL0 has a temporary `advanced_wholesale` add-on through 2026-10-14 23:59:59 Asia/Manila. The owner separately enabled the tenant toggle; entitlement and toggle changes retain audit and outbox evidence.
- Controlled Staging order `SO-20261008-001` passed the AW1 lifecycle: draft left stock at 9 available with zero reservation; confirmation appended a +6 reservation and reduced available to 3 without changing on-hand; cancellation appended -6, restored available to 9, and preserved the cancelled order. Confirm and cancel each produced exactly one audit event and one outbox event. Evidence is recorded in `docs/qa/STAGING_ADVANCED_WHOLESALE_AW1_UAT_2026-10-08.md`.
- Post-deployment Supabase advisors report no warning- or error-level findings. The three AW1 tables retain the intentional private-schema RLS-without-browser-policy posture; informational foreign-key index candidates are tracked for measured performance work rather than speculative removal or addition.
- The owner approved `APPROVED ADVANCED WHOLESALE AW2 - PROCEED TO BUILD` on 2026-10-08 for local implementation only. The AW2 branch now contains partial fulfillment, shared-stock reservation consumption, immutable invoices, combined Sales archive records, printable invoice presentation, and `all`/`pos`/`wholesale` reporting contracts. No AW2 migration or Worker build has been applied to Staging or Production.
- Advanced Wholesale AW2 branch CI run `37731734969` passed the fail-closed dependency gate, tracked-file secret scan, formatting, lint, strict typecheck, all 93 Vitest cases, all standard and Cloudflare builds, a fresh Supabase reset, and every pgTAP suite including the 56-assertion AW2 fulfillment, invoice, reporting, immutability, idempotency, authorization, and tenant-isolation coverage.
- Staging migration `20261008045840_advanced_wholesale_partial_fulfillment_invoices` is recorded with the exact repository version. Staging API Worker `4b94f93c-fb64-48d2-ab5f-bb51e7b402c8` and corrected Back Office Worker `49e3b2d7-f7a1-4a43-8796-9b34f1f9c1c8` are deployed with staging-only bindings and public configuration. Health, authentication rejection, exact-origin CORS, and `/wholesale` checks returned 200, 401, 204, and 200.
- Controlled Staging order `SO-20261008-002` passed the AW2 lifecycle. Six shared-stock units were reserved, two units produced immutable invoice `INV-20261008-000001` for PHP 1,600.00, and the remaining four produced `INV-20261008-000002` for PHP 3,200.00. The order is fulfilled, invoice quantities reconcile to six, on-hand is 3, and reserved is 0. The Sales archive rendered the completed invoice snapshot and kept wholesale refund/void disabled for AW4. Evidence is recorded in `docs/qa/STAGING_ADVANCED_WHOLESALE_AW2_UAT_2026-10-08.md`.
- AW2 UAT identified and corrected a Back Office order-number suggestion defect: after a cancelled order, the new-draft form could suggest the cancelled number once. The API uniqueness guard rejected the duplicate without mutation. The UI now advances from the highest same-day ordinal across every order status, with regression coverage for gaps, prior days, and malformed values.
- Both scoped temporary AW2 Staging deployment tokens were revoked after release and the Supabase account token list was verified empty.
- AW2 Production release review passed on 2026-10-09 without changing Production. Production is on PostgreSQL 17.11 with 48 migrations, zero open register sessions, zero outstanding reservations, no pre-existing AW1/AW2 tables, zero legacy sales that violate the new actor-context rule, and no warning- or error-level Security Advisor blocker. Production-configured API and Back Office candidates passed Cloudflare dry runs; the Back Office bundle contains Production references and zero Staging/local references. GitHub Actions run `37858482098` passed both jobs and all 850 database assertions. The release adds exactly three ordered migrations and keeps `advanced_wholesale` unavailable and disabled until separate audited entitlement and owner-toggle actions. Detailed evidence and the deployment/rollback sequence are in `docs/operations/PRODUCTION_AW2_RELEASE_REVIEW_2026-10-09.md`.
- The owner approved the AW2 Production migration and deployment on 2026-10-09. Production now records all 51 repository migrations, including the AW1 sales-order foundation, owner-controlled tenant toggle, and AW2 partial-fulfillment/invoice migration. Post-migration checks found the expected five new business tables, zero open register sessions, zero outstanding reservations, zero invalid sales actor rows, and no Security Advisor warning or error.
- Production API Worker `4a9e6c13-5caf-4f86-bbed-50ec2c17a34a` and Back Office Worker `afeee125-e2bf-42a3-8892-53d2ee0c9ae8` are deployed. Back Office root, `/wholesale`, API health, unauthenticated guard, and exact-origin CORS checks returned 200, 200, 200, 401, and 204. The Back Office bundle contains Production-only references.
- Advanced Wholesale remains fail-closed in Production: the platform feature is available, but no Production tenant currently has the add-on entitlement or enabled toggle. The temporary Production Supabase CLI token was revoked, the account token list was verified empty, and the local CLI was unlinked from Production. Evidence is recorded in `docs/qa/PRODUCTION_ADVANCED_WHOLESALE_AW2_RELEASE_2026-10-09.md`.
- Production owner password recovery now supports MFA-enabled accounts. The recovery screen upgrades an AAL1 recovery session through the existing verified TOTP factor before allowing a password update and fails closed when the required factor is unavailable. Full repository verification passed with 100 Vitest cases, and Production Back Office Worker `b91fc400-6639-426e-8ad0-978ebb459f05` passed root/recovery/API/auth/CORS smoke checks. The owner must complete the final authenticator and password entry from the newest recovery email. Evidence is recorded in `docs/qa/PRODUCTION_PASSWORD_RECOVERY_MFA_HOTFIX_2026-10-09.md`.

## Next safe action

Production Super Admin access was verified on 2026-10-10 with MFA and the provisioned owner role. The owner retained the existing password. The audited Advanced Wholesale grant for SAH RESTORATION was submitted with an activation reason and no expiry; the platform UI confirmed Granted. The owner-authorized Business Setup feature save enabled Advanced Wholesale and returned Setup progress saved. The Production wholesale workspace loaded zero orders, the existing reseller, Main Store, Dealer/Wholesale price lists, and SAH-00001 with 95 available shared-stock units. No order, reservation, fulfillment, invoice, or payment was created during activation.

The owner approved the permanent Production AW2 order on 2026-10-10. Order SO-20261010-001 fulfilled 10 SAH-00001 units at PHP 450.00 in two five-unit batches. Invoices INV-20261010-000001 and INV-20261010-000002 each total PHP 2,250.00. The authenticated UI verified final shared inventory of 85 on hand, zero reserved, and 85 available, with two -5 sale movements. No payment was posted; AW3 payment allocations and AW4 returns/credits remain unavailable. Evidence and verification limits are recorded in `docs/qa/PRODUCTION_ADVANCED_WHOLESALE_AW2_UAT_2026-10-10.md`.

The owner confirmed on 2026-10-10 that both retained PHP 2,250.00 Production invoices should become explicit unpaid opening receivables, with cash as the intended payment method and the same due date of 2026-10-10. No payment or opening entry has been posted. Cash does not authorize an inferred customer payment term or credit limit.

AW3 local foundation now contains strict command contracts and framework-independent due-date, aging, credit-exposure, fulfillment-payment, and allocation rules. These are not connected to the database, API, or UI yet. The implementation sequence and historical-invoice boundary are recorded in `docs/product/ADVANCED_WHOLESALE_AW3_IMPLEMENTATION.md`.

Local foundation verification on 2026-10-10 passed `npm run check`, including 151 Vitest cases (51 new), formatting, lint, typechecks, standard/Cloudflare builds, and the tracked-file secret scan. No SQL migration, database integration test, browser UAT, push, or deployment was performed for AW3.

The AW3 explicit legacy-opening database/API candidate is now written locally. Migration `20261010111813` adds an immutable eligibility registry and opening charge ledger without automatic debt posting. Authorized read/opening routes derive the actor/tenant and invoice amount on the server; the database command requires an active owner, rechecks entitlement, and records idempotency/audit/outbox atomically. The latest Vitest run passed 166 cases. No AW2 fulfillment/confirmation behavior has changed.

Local database infrastructure remains unavailable, but opening-slice execution verification passed in isolated GitHub CI on 2026-10-10. Feature branch `codex/advanced-wholesale-aw3` was secret-scanned, committed, and pushed; CI run `38052333432` verified commit `7ccae44c14da03ba0e6d972c5eece92a11a95234`. Both jobs passed: dependency security, secret scan across 370 tracked files, formatting, lint, typechecks, 166 Vitest cases, standard/Cloudflare builds, a fresh Supabase reset, and all 881 pgTAP assertions across 32 files (31 new opening checks). The invalid `inactive` membership test fixture was corrected to `suspended` before this run. Evidence is in `docs/qa/AW3_OPENING_RECEIVABLES_CI_2026-10-10.md`. No merge, Staging/Production migration or deployment, or Production opening entry was performed.

The AW3 customer credit-settings candidate is now written locally in migration `20261010123904`, with authorized GET/POST `/v1/wholesale/credit-settings` routes. Active resellers have explicit terms and integer-minor-unit credit limits, stored as immutable revisions with actor/reason, audit, outbox, and idempotency. Unconfigured settings remain null. Owner or explicitly authorized wholesale managers can write; readers cannot. The customer row lock serializes revisions. `npm run check` passed with 180 tests, formatting, lint, typechecks, standard/Cloudflare builds, and secret scanning. A post-staging secret scan passed across 373 tracked files. Disposable database CI verification is pending for this candidate. No settings command has run in Staging or Production, and existing AW2 commands do not yet enforce these settings.

Settings verification subsequently passed in isolated CI run `38054006849` for commit `76b4f188c8dc6507508e9b1c797b1d8c753ab1ce`: both application and database jobs succeeded, including 180 unit cases and 913 pgTAP assertions across 33 files (32 new settings checks). Evidence is in `docs/qa/AW3_CREDIT_SETTINGS_CI_2026-10-10.md`. Migration `20261010123904` was applied only to the disposable CI database; no live settings or Production invoices changed.

The next AW3 credit-enforcement candidate is written locally in migration `20261010133336`. Authorized wrappers preserve the existing shared-inventory commands while adding customer locking, immutable confirmed terms, net invoice charges/due dates, latest-limit checks, and rollback of denied commands. Historical unclassified invoices block credit, and prepaid/COD cannot fulfill without a genuine payment command. Direct execute grants on the inventory cores are revoked. The read contract now distinguishes normal invoice debt from opening and unclassified invoices. Regression and three multi-session concurrency scenarios are added; candidate execution verification is pending.

Enforcement execution verification subsequently passed: local `npm run check` completed with 184 unit tests; staged secret scanning passed across 376 files. CI run `38057004425` verified commit `04778d2a84ae9da20e0e35b74d5079dcf5f8ad91`, with both jobs successful, fresh migration reset, 945 pgTAP assertions across 33 files, and three actual multi-session checks (competing confirmations, limit reduction versus fulfillment, and simultaneous fulfillment replay). The initial concurrency fixture omitted a required contact; it was corrected with synthetic test email before the complete rerun. Evidence is in `docs/qa/AW3_CREDIT_ENFORCEMENT_CI_2026-10-10.md`. No merge or live environment change occurred.

The dedicated override approval/revocation backend is verified on feature-branch commit `23197715855568f202610552e2e760a40b93b849` in isolated CI `38058245765`: 200 unit tests, fresh migration reset, 973 pgTAP assertions across 33 files, and three existing credit-enforcement concurrency scenarios passed. Migration `20261010135722` adds strict contracts and GET/POST approval plus POST revocation APIs. Active owner or explicitly authorized approver with wholesale-management access can approve a specific order/action, positive exact excess amount, reason, and future expiry. Tenant/customer/actor are server-derived. Approvals and revocations are immutable, audited, outbox-backed, and idempotent. Approved records are not consumed by confirm/fulfill yet and cannot bypass current limits. Dedicated approval-consumption and revocation race tests remain required. Evidence: `docs/qa/AW3_CREDIT_OVERRIDE_APPROVALS_CI_2026-10-10.md`. No merge or live deployment occurred.

Atomic scoped override consumption is verified in migration `20261010142545`, with strict optional approval IDs on confirmation/fulfillment APIs. Commands record immutable exact excess, exposure, current limit, actor, and command identity, with audit/outbox; order/customer locks serialize revocation and use. Scope, expiry, revocation, positive excess within approval cap, and single-use checks are transactional. Historical replay is bound to the original consumption and cannot select another approval. Local `npm run check` passed with 208 tests. CI `38060191768` verified commit `5f73b2803f240d9f570ca3f083b7e94ab1ab78c9`: both jobs passed, including fresh reset, 1,018 pgTAP assertions across 34 files, and seven actual multi-session scenarios (three existing credit races plus four scoped override races). Evidence: `docs/qa/AW3_CREDIT_OVERRIDE_CONSUMPTION_CI_2026-10-10.md`. No merge, live migration, deployment, or Production business change occurred.

The payment/allocation backend candidate is now written locally in migration `20261010144125`, with strict POST `/v1/wholesale/payments`. It records manually received money and exact invoice allocations as immutable ledgers, atomically updates derived open balances/credit exposure, rejects unclassified invoices and overpayments, and uses customer/invoice locks with replay authorization. Recording requires an active owner or explicit `wholesale_payments.record` plus wholesale read and assigned branch access. No automated gateway charge, POS register/cash movement, or automatic fund allocation is created. Current unit run passed 224 tests; complete migration/concurrency execution verification is pending.

Payment/allocation execution verification passed in isolated CI `38063757985` for commit `6cda83c92488939d01397ad27bf9d35c5115189c`: both jobs passed, including 224 unit tests, fresh migration reset, 1,074 pgTAP assertions across 35 files (56 dedicated payment checks), and nine actual multi-session scenarios. Simultaneous multi-invoice receipt replay posts once; competing distinct payments cannot over-allocate the remaining balance. The first run exposed a test fixture that reused an unchanged request hash for a changed amount; the fixture was corrected without weakening the command. Evidence: `docs/qa/AW3_PAYMENT_ALLOCATIONS_CI_2026-10-10.md`. No merge, live migration, deployment, or Production payment occurred.

The 2026-10-11 receipt-history/payment-screen candidate adds GET `/v1/wholesale/payments`, migration `20261011013731`, and `/wholesale/payments` in Back Office. Authorized readers can inspect receipts/allocations and balances; recording authority and branch eligibility are server-derived. Entries use exact centavo parsing and explicit customer/invoice allocations. Uncertain requests keep their original key/payload in account-and-tenant-scoped session storage for retry after reload. Known database rejection releases the form; ambiguous outcomes retain the pending command. Synthetic browser tests passed partial entry, reload/retry identity, receipt expansion, desktop/mobile overflow, and page-error checks. Complete candidate CI verification is pending; no live data or deployment changed.

Receipt-history/payment-screen verification subsequently passed in isolated CI `38102962836` for commit `fc82f7f7112b0ad745b93d1b9a2faf8644dcef94`: both jobs passed, including 255 unit tests, complete security/format/lint/type/build checks, fresh reset, 1,085 database assertions across 35 files, nine independent-session scenarios, and stack cleanup. Synthetic browser checks additionally verified definitive balance rejection unlocks editing and revoked recording authority produces read-only controls. Pending retries are retained on authorization/scope failures because those failures can occur after a successful receipt. Evidence: `docs/qa/AW3_PAYMENT_HISTORY_UI_CI_2026-10-11.md`. No live deployment, opening classification, or payment occurred.

The 2026-10-11 settlement-report candidate adds migration `20261011021743`, GET `/v1/reports/wholesale-settlement`, and `/wholesale/settlement` linked from Reports and Payments. Issued invoices, period receipt allocations, explicit opening charges, classified closing balances, and unknown invoice values are separate. Historical cutoff follows the tenant reporting timezone; later invoices, charges, and receipts cannot leak into prior closing balances. Location totals use invoice allocations, not entire multi-location receipt headers. Owner or both wholesale-read and reports-read authorization is required. The CSV escapes formula-like labels. This is manual receipt reporting, not bank reconciliation or proof that non-cash funds settled. Unit verification passed 274 cases; complete candidate database/build/browser verification is pending.

Settlement-report verification subsequently passed in isolated CI `38105206293` for commit `839c183c94ff607f103544936778a03f2c3bb111`: both jobs passed, including 274 unit tests, full security/format/lint/type/build checks, fresh reset, 1,107 pgTAP assertions across 35 files, nine independent-session scenarios, and stack cleanup. Synthetic desktop/mobile browser checks passed financial-total separation, incomplete-classification warnings, exact CSV download, date/location forwarding, failed-refresh stale-data removal, and overflow/page-error checks. Evidence: `docs/qa/AW3_SETTLEMENT_REPORT_CI_2026-10-11.md`. The report does not create payments, fund entries, or proof of bank settlement. No live environment changed.

The user-confirmed fund-allocation candidate adds migration `20261011031029`, GET/POST `/v1/wholesale/funds`, and `/wholesale/funds`. Operators attest actual full settlement with reference/reason and manually select an exact split into Capital/COGS and Operating; no preset percentages or bank/provider confirmation is inferred. One receipt can be allocated once, with immutable confirmation and nonzero fund movements, atomic audit/outbox/idempotency, receipt locking, and current fund/wholesale permissions. No live receipts are backfilled and no revenue, stock, customer debt, POS cash, or bank transfer changes. The full unit run passed 289 tests; synthetic desktop/mobile browser checks passed split rejection, uncertain reload/retry identity, balances/history, read-only authority, and layout/page-error checks. Complete local/database/CI verification is pending. Partial allocation and fund correction/reversal UI are outside this first candidate.

Fund-allocation verification subsequently passed in isolated CI `38108366556` for commit `317244d30502075298064642bc2a489d9039194b`: both jobs passed full application/security/build verification with 297 unit tests, fresh reset, 1,136 pgTAP assertions across 35 files, eleven independent-session scenarios, and cleanup. The two new fund races verify identical retries post once and competing commands cannot allocate a receipt twice. Definitive duplicate rejection releases browser editing; unknown/authorization results retain retry identity. Synthetic browser checks passed this follow-up as well. Evidence: `docs/qa/AW3_FUND_ALLOCATION_CI_2026-10-11.md`. No live migration, receipt, fund entry, or deployment occurred.

Prepaid/COD candidate local `npm run check` passed with 322 unit tests across sixteen files, secret scan, format/lint/typechecks, standard builds, and Cloudflare dry-run/builds. Browser checks passed with entirely synthetic fixtures. Isolated CI `38110566169` verified commit `d1cd3b537c1f1662f60182d08e0f053a351a6195`: both jobs passed, with fresh migration reset, 1,169 pgTAP assertions across 35 files, thirteen independent-session scenarios, and cleanup. Two new prepaid races prove identical replay posts once and distinct competing deliveries cannot double-post invoice/receipt/stock. Evidence: `docs/qa/AW3_PAID_FULFILLMENT_CI_2026-10-11.md`. No live environment changed.

Approval history local `npm run check` passed: 330 unit cases across seventeen files, format/lint/typechecks, standard builds, API dry run, and Cloudflare builds. Staged secret scanning passed across 416 files. CI `38112931956` verified commit `6fddb741202d40124c5c5680e651a7951230cebc`: both jobs passed with fresh reset, 1,181 pgTAP assertions across 35 files, thirteen independent-session scenarios, and cleanup. Twelve new history assertions verify accurate statuses, exact consumed amounts, preserved revocation, read-only behavior, and private execute grants. Browser tests verified read-only history and failed-refresh recovery with synthetic fixtures. Evidence: `docs/qa/AW3_APPROVAL_HISTORY_CI_2026-10-11.md`.

Next: build approval/revocation/selection controls and remaining cross-command concurrency before the complete Staging release/UAT gate. Production release remains separate. Payment versus confirmation/opening and cancellation races remain required as affected commands are completed. AW4 returns/credits and Online Store remain later slices. No live environment has received any AW3 migration or command.

## Production state

- Production API URL: `https://hustlero-hcs-api.scaleopsph.workers.dev`
- Production Back Office URL: `https://hustlero-hcs-backoffice.scaleopsph.workers.dev`
- Production POS URL: `https://hustlero-hcs-pos.scaleopsph.workers.dev`
- Production Super Admin URL: `https://hustlero-hcs-admin.scaleopsph.workers.dev`
- Development API URL: `https://hustlero-hcs-api-development.scaleopsph.workers.dev`
- Staging API URL: `https://hustlero-hcs-api-staging.scaleopsph.workers.dev`
- Staging Back Office URL: `https://hustlero-hcs-backoffice-staging.scaleopsph.workers.dev`
- Staging POS URL: `https://hustlero-hcs-pos-staging.scaleopsph.workers.dev`
- Staging Super Admin URL: `https://hustlero-hcs-admin-staging.scaleopsph.workers.dev`
- Production data: one controlled owner, one configured pilot tenant, one catalog variant, one opening balance, one cashier, one register, one active POS device, four controlled UAT receipts, one live-pilot receipt, two active Basic Wholesale price lists, and one controlled reseller profile; SAH Advanced Wholesale is enabled with one fulfilled order, two retained invoices totaling PHP 4,500.00, and 85 shared-stock units available
- Production deployment: provisioned, smoke-tested, UAT sale/refund/reconciliation validated, rollback exception approved, live pilot go-live approved, first live shift transaction plus zero-variance close validated, Basic Wholesale/Dealer activation UAT completed with both receipts fully reversed and its register reconciled at zero variance, and AW2 schema/API/Back Office deployed fail-closed; no register session is open
- Rollback point: previous immutable Worker versions remain available; database recovery follows `docs/operations/RECOVERY_RUNBOOK.md`
