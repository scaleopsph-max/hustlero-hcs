# Production AW2 Release Review

Last reviewed: 2026-10-09

## Decision

**GO pending explicit owner deployment approval.** Advanced Wholesale AW2 passed CI, isolated Staging deployment, controlled Staging UAT, Production compatibility checks, Production-configured application builds, and Cloudflare dry runs. This review did not change Production.

The approval phrase for the release window is:

`APPROVE AW2 PRODUCTION MIGRATION AND DEPLOYMENT`

## Release scope

Production currently has 48 migrations through `20261003055709_wholesale_pricing_foundation`. The release adds these three ordered migrations:

1. `20261005233310_advanced_wholesale_sales_orders`
2. `20261007043637_advanced_wholesale_tenant_toggle`
3. `20261008045840_advanced_wholesale_partial_fulfillment_invoices`

The release includes sales-order drafts and confirmation, shared-inventory reservations, cancellation, partial fulfillment, immutable invoices, combined POS/wholesale Sales archive reporting, and printable invoice presentation. AW3 payment terms and allocations, AW4 returns and credits, and Online Store are not part of this release.

## Evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| Branch verification | Pass | GitHub Actions run `37858482098` passed application checks, a fresh migration replay, and all 850 database assertions. |
| Staging deployment | Pass | Staging records all 51 migrations. API `4b94f93c-fb64-48d2-ab5f-bb51e7b402c8` and Back Office `49e3b2d7-f7a1-4a43-8796-9b34f1f9c1c8` are deployed with Staging-only bindings. |
| Staging UAT | Pass | `SO-20261008-002` reserved six units and fulfilled them as two immutable invoices for 2 and 4 units. On-hand ended at 3 and reserved at 0. |
| Production database compatibility | Pass | PostgreSQL is 17.11. AW1/AW2 tables do not already exist, no existing sale violates the new actor-context constraint, and relevant installed extensions are compatible (`citext` 1.6 and `pgcrypto` 1.3). |
| Production operating window | Pass | Zero open register sessions and zero outstanding inventory reservations were found. |
| Feature isolation | Pass | Production `advanced_wholesale` is platform-unavailable with zero entitlement rows. Migrations create disabled entitlement rows and do not grant or enable SAH access automatically. |
| Security review | Pass | Security Advisor has no warning- or error-level release blocker. The 61 informational no-policy findings are the established private-schema deny-by-default posture. |
| Performance review | Pass | Performance Advisor has no release-blocking finding. Existing informational foreign-key and unused-index candidates remain tracked. |
| API candidate | Pass | Production-configured API build passed Cloudflare dry run with Production Hyperdrive `a611fc9b39974b59a887529621440b6c`. |
| Back Office candidate | Pass | Production build completed, `/wholesale` is present, bundle inspection found Production Supabase/API references and zero Staging/local references, and Cloudflare dry run passed. |

## Migration impact

- The three migrations are additive. They do not drop or truncate business tables.
- Existing sales are backfilled as `channel = 'pos'`; all current rows satisfy the new POS actor-context rule.
- Register, register-session, and employee references become nullable only for wholesale invoice sales. POS commands retain their required actor context.
- Draft sales-order line replacement is permitted only inside the draft-editing command. Confirmed reservations, fulfillment movements, invoices, invoice lines, audit events, and outbox rows remain append-only.
- The existing Basic Wholesale and POS applications remain schema-compatible because new fields have safe defaults and the new feature remains disabled until separately entitled and enabled.

## Deployment runbook

1. Reconfirm Production health, zero open register sessions, zero outstanding reservations, and an available Supabase recovery point.
2. Create one narrowly scoped temporary Supabase CLI token for the release window.
3. Apply the three migrations in the exact order above and verify the migration ledger.
4. Re-run schema, grant, RLS, Security Advisor, and baseline data checks.
5. Deploy the Production API candidate and verify health 200, unauthenticated access 401, and exact-origin CORS 204.
6. Deploy the Production Back Office candidate and verify HTTP 200, authentication, tenant loading, and `/wholesale` routing.
7. Grant the SAH tenant the `advanced_wholesale` add-on, then let the owner enable it through Business Setup. These remain separate audited actions.
8. Run controlled Production UAT: draft, confirm, reservation reconciliation, first partial fulfillment, final fulfillment, both invoice snapshots, Sales archive, and shared-stock reconciliation.
9. Keep wholesale refund and void unavailable until AW4. Do not alter invoice history during UAT cleanup.
10. Revoke the temporary Supabase token and verify the account token list.

## Rollback and stop conditions

Worker traffic can return to the currently deployed API version `5c82d179-84bb-4145-8055-bd826da7cfaa` and Back Office version `a8753db5-c0c1-4e93-8091-3ffd78f2dadc` if application smoke checks fail. The database changes are additive but have no automated down migration; database recovery follows `docs/operations/RECOVERY_RUNBOOK.md`.

Stop the release before feature activation if any migration fails, the migration ledger differs from the repository, an existing sale violates actor context, a warning- or error-level security finding appears, health/auth/CORS checks fail, or inventory reservations do not reconcile. Stop UAT immediately if invoice quantities, order status, on-hand stock, or reserved stock diverge.

