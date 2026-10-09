# Production Advanced Wholesale AW2 Release - 2026-10-09

## Approval and scope

The owner approved `APPROVE AW2 PRODUCTION MIGRATION AND DEPLOYMENT`. This release deployed the already-reviewed AW1 sales-order foundation and AW2 partial-fulfillment/invoice slice to Production. It did not grant the add-on to a tenant or enable the tenant feature toggle.

## Database deployment

Production project `gmprhuzbisfylidjpfob` was healthy on PostgreSQL 17.11 before deployment. The migration dry run listed exactly these three ordered migrations, and the applied ledger now contains 51 migrations:

1. `20261005233310_advanced_wholesale_sales_orders.sql`
2. `20261007043637_advanced_wholesale_tenant_toggle.sql`
3. `20261008045840_advanced_wholesale_partial_fulfillment_invoices.sql`

Post-migration verification confirmed the sales-order, line, reservation-ledger, invoice, and invoice-line tables. Production retained zero open register sessions, zero outstanding reservations, zero non-POS sales, and zero invalid POS actor rows. The platform add-on remains available while tenant entitlement and tenant enablement both remain zero.

The Security Advisor reported no warning- or error-level finding. Its 67 informational `rls_enabled_no_policy` notices match the intentional private-schema, API-only posture. The Performance Advisor returned only established informational findings; no release blocker was introduced.

## Application deployment

- API Worker version: `4a9e6c13-5caf-4f86-bbed-50ec2c17a34a`
- Back Office Worker version: `afeee125-e2bf-42a3-8892-53d2ee0c9ae8`
- API URL: `https://hustlero-hcs-api.scaleopsph.workers.dev`
- Back Office URL: `https://hustlero-hcs-backoffice.scaleopsph.workers.dev`

The Back Office production bundle contained 46 Production Supabase references and 46 Production API references, with zero Staging Supabase, Staging API, or localhost references. The generated local `.dev.vars` file was removed before deployment.

## Smoke validation

- Back Office root: HTTP 200
- Back Office `/wholesale`: HTTP 200
- API `/health`: HTTP 200
- Unauthenticated API `/v1/me`: HTTP 401
- Production Back Office-origin CORS preflight to `/v1/me`: HTTP 204 with the exact Production origin

The pre-release branch CI run `37858482098` passed both jobs and all 850 database assertions. No additional source-code change was made during the controlled release.

After deployment, a fresh local `npm run check` passed the tracked-file secret scan, formatting, lint, strict typecheck, all 96 Vitest cases, all standard application builds, and all Cloudflare builds.

## Credential cleanup

The temporary project-scoped Production Supabase CLI token was revoked immediately after deployment. The Supabase access-token page was verified to show no remaining access tokens. The local CLI was unlinked from Production after the migration was complete. No token value is stored in the repository or this evidence file.

## Release boundary and next action

AW2 infrastructure and application code are deployed but remain fail-closed for `SAH RESTORATION`. The next controlled step is a separate audited entitlement grant, followed by owner feature enablement and Production AW2 order/partial-fulfillment/invoice UAT. AW3 payment terms and allocations, AW4 returns and credit notes, and Online Store remain later slices.
