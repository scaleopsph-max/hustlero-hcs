# Staging Basic Wholesale Validation

Date: 2026-10-05

Environment: Staging only

Supabase project: `sdfwdhbryjyfufgtfqmf`

## Scope

This validation covers deployment of the Basic Wholesale foundation to Staging. Retail, Wholesale, and Dealer sales continue to consume the same location-and-variant inventory balance. Price selection remains tenant-scoped, server-authoritative, reseller-gated, and quantity-threshold controlled.

Production was not migrated or deployed during this validation.

## Database deployment

- Migration `20261003055709_wholesale_pricing_foundation.sql` passed a transactional dry run against Staging before application.
- The managed migration was initially recorded with generated version `20261004022946`; only the migration-ledger version was corrected immediately to the committed repository version `20261003055709`. The schema SQL was not replayed.
- Staging now records 48 ordered migrations, ending with `20261003055709 wholesale_pricing_foundation`.
- The four pricing tables are present with RLS enabled.
- Browser roles and the restricted Hyperdrive role have no direct pricing-table privileges. Hyperdrive execution remains limited to approved functions.
- Transactional fixtures were absent after the test run, confirming rollback cleanup.

## Automated validation

- All 29 Staging database suites passed: 745 assertions total.
- The shared-inventory priced-sale suite covers Retail, Wholesale, Dealer, reseller eligibility, thresholds, immutable price snapshots, idempotency, cross-tenant denial, full refund, and stock restoration.
- The complete local `npm run check` passed: secret scan, formatting, ESLint, all workspace TypeScript checks, 91/91 Vitest tests, standard builds, and Cloudflare/Vinext builds.
- The Security Advisor returned only 61 informational private-schema RLS-without-policy findings. This is the established RPC-only posture: RLS is enabled and browser roles have no direct table grants.
- The Performance Advisor returned informational index opportunities. Two wholesale-related supporting indexes are tracked for performance tuning; no correctness, security, or release-blocking finding was reported.

## Staging deployment

- API Worker version `662dfd68-4d38-4057-98e9-d4516de70231` was deployed as `hustlero-hcs-api-staging` with the Staging Supabase URL, Staging Hyperdrive binding, and exact Staging application origins.
- Back Office Worker version `44eb329d-7f7a-450c-810b-82523218cac3` was rebuilt with only Staging Supabase/API public configuration and deployed explicitly as `hustlero-hcs-backoffice-staging`.
- POS Worker version `44f353b1-bfff-4925-9f56-075679a36df3` was rebuilt with only the Staging API URL and deployed explicitly as `hustlero-hcs-pos-staging`.
- Generated Back Office and POS bundles contained the expected Staging references and zero Development references.
- Both temporary Staging wholesale access tokens were revoked after deployment. The Supabase account token list was verified to show no remaining access tokens.

## Smoke checks

- `GET /health` returned `200` with environment `staging`.
- Unauthenticated `GET /v1/me` returned `401`.
- Back Office and POS CORS preflights returned `204` with their exact allowed origins.
- Staging Back Office `/pricing` and Staging POS `/sell` both returned `200`.
- The deployed Back Office exposes the Wholesale pricing workspace and correctly reaches the sign-in boundary when no active owner session is present.

## Authenticated UAT

The owner signed in through the Staging Back Office and the previously confirmed `EMP-001` cashier signed in through the Staging POS. Generated test data used the existing `PABL0` tenant, existing variants, the existing standard customer `CUST-000001`, and generated reseller `CUST-000002` (`example.invalid` contact only).

- Created and read back the default `WHOLESALE` list at PHP 800.00 per variant with a 6-unit threshold.
- Created and read back the `DEALER` list at PHP 700.00 per variant with a 10-unit threshold.
- During setup, both lists initially reused the `CORE` pricing group. The Dealer list was corrected to its own `DEALER-CORE` group, and the final database readback confirmed independent 6-unit and 10-unit thresholds. Shared inventory remained one location-and-variant balance.
- Retail baseline sale: one `P-00001` at PHP 999.00, receipt `MAIN-20261005-000001`; full refund returned one unit to stock.
- Ineligible standard-customer wholesale attempt stayed blocked with the reseller requirement and disabled charge.
- Below-threshold reseller wholesale attempt stayed blocked at one unit with `Core products needs 6 units` and disabled charge.
- Qualified wholesale sale: six `P-00001` units at PHP 800.00, total PHP 4,800.00, receipt `MAIN-20261005-000002`; full refund returned six units and reversed 48 loyalty points.
- Qualified Dealer sale: ten `P-00002` units at PHP 700.00, total PHP 7,000.00, receipt `MAIN-20261005-000003`; full refund returned ten units and reversed 70 loyalty points.
- Inventory readback returned the original balances: `P-00001` 9 units and `P-00002` 10 units, with zero reserved, in-transit, and damaged quantities.
- The Staging Main Register closed at PHP 1,000.00 expected and PHP 1,000.00 counted, with zero variance and zero open sessions.

## Result

Staging database deployment, security posture, automated tests, application builds, isolated Worker deployments, public smoke checks, authenticated pricing, retail/wholesale/dealer qualification, rejection guards, shared-inventory movement, refunds, loyalty reversals, and register reconciliation all passed. Production remains unchanged; this slice is ready for owner approval before a separate Production wholesale migration and deployment.
