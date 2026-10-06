# Development Basic Wholesale Validation

Date: 2026-10-03

Environment: Development only

Supabase project: `nlrzdgcxydmcvhushzwv`

Cloudflare API Worker: `hustlero-hcs-api-development`

## Scope

This validation covers the Basic Wholesale foundation defined by ADR-038. Retail, wholesale, and dealer sales share the same location-and-variant inventory balance. Wholesale and dealer prices are tenant-scoped, server-authoritative, quantity-threshold controlled, and limited to eligible reseller customers.

Staging and Production were not migrated or deployed during this validation.

## Database deployment

- Migration `20261003055709_wholesale_pricing_foundation.sql` was dry-run against the Development migration ledger and was the only pending migration.
- The migration was applied to Development and is recorded in `supabase_migrations.schema_migrations`.
- Four pricing tables are present and all four have RLS enabled.
- `anon`, `authenticated`, and `hcs_hyperdrive` have no direct privileges on the pricing tables.
- `hcs_hyperdrive` can execute only the approved pricing and priced-sale functions.
- Test fixture tenants were absent after the transactional test run, confirming rollback cleanup.

## Automated validation

- All 29 database pgTAP suites passed: 745 assertions total.
- The wholesale priced-sale suite passed 36 assertions covering Retail, Wholesale, Dealer, reseller eligibility, thresholds, server prices, immutable price snapshots, idempotency, cross-tenant rejection, full refund, and shared inventory movements.
- The wholesale schema/security suite passed 21 assertions.
- `supabase db lint --linked` completed successfully. It reported warning-only findings in older functions and no wholesale migration finding.
- `npm run check` passed in full:
  - tracked-file secret scan
  - formatting
  - ESLint
  - all workspace TypeScript checks
  - 91/91 Vitest tests
  - standard production builds
  - Cloudflare/Vinext builds

## Development deployment and smoke test

- API Worker version `4dcef5a8-3265-4a07-b140-3e4096545069` deployed to Development only.
- `GET /health` returned `200` with environment `development`.
- Unauthenticated `GET /v1/me` returned `401`.
- Back Office-origin preflight returned `204` and allowed `http://localhost:3001`.

## Back Office UAT

The authenticated local Back Office loaded the `SCALEOPS PH` Development tenant and created the default active `WHOLESALE` price list through `/pricing`.

- Minimum grouped quantity: `6.000`
- `CUTOVER-UAT-001`: PHP 80.00
- `SAH-00001`: PHP 750.00
- The database readback matched the UI values exactly.

The local POS loaded the existing Development device and reached the employee sign-in boundary. No employee PIN was guessed or reused from another environment, so an authenticated browser checkout was not posted in this pass. The same priced-sale path was validated transactionally by the 36-assertion remote pgTAP suite.

## Result

Development database, API, security, Back Office pricing, and automated end-to-end domain gates passed. The slice is eligible for a controlled Staging migration and UAT after owner approval; Production remains on the previously verified retail release.
