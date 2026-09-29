# Supabase Organization Transfer Audit

Date: 2026-09-29

## Scope

The existing Supabase Development and Staging projects were transferred from the Free `HUSTLERO (HCS)` organization to the existing Pro `scaleopsph-max's Org` organization.

This was an organization ownership and billing transfer. It was not a database copy, database restore, region move, or credential rotation. Project references, database hosts, regions, API URLs, and application environment values remained unchanged.

## Projects

| Environment | Project | Reference | Region | Post-transfer status |
| --- | --- | --- | --- | --- |
| Development | `HUSTLERO (HCS)` | `nlrzdgcxydmcvhushzwv` | Singapore (`ap-southeast-1`) | `ACTIVE_HEALTHY` |
| Staging | `HUSTLERO HCS Staging` | `sdfwdhbryjyfufgtfqmf` | Singapore (`ap-southeast-1`) | `ACTIVE_HEALTHY` |

Both projects now report organization ID `vxspwhtwaonuxgarurep`.

## Pre-transfer controls

- The operator was verified as Owner of the source and target organizations.
- Supabase transfer previews reported both projects eligible.
- Neither project had a connected GitHub integration, configured Log Drain, development branch, or Edge Function.
- Both databases had the same application-schema fingerprint: `5986240f9700d95e0e228129fc4578cb`.
- Both migration ledgers contained the same ordered set of 47 migration names.
- Exact row-count snapshots were captured for tenant, workforce, catalog, inventory, purchasing, transfers, register, sales, customer, loyalty, finance, Auth, and Storage records.

## Post-transfer verification

- Development and Staging retained their original project references, database hosts, Singapore regions, and PostgreSQL versions.
- Both projects returned `ACTIVE_HEALTHY` under the target Pro organization.
- Development retained its pre-transfer schema fingerprint and exact row counts, including 2 tenants, 3 products, 4 variants, 10 inventory movements, 3 sales, 2 refunds, and 2 Auth users.
- Staging retained its pre-transfer schema fingerprint and expected empty-data state.
- Development and Staging still contain the same ordered 47 migration names; each ends with `pos_multi_tender_payments`.
- Staging API health, POS, Back Office, and Super Admin endpoints all returned HTTP 200.
- The staging checkout endpoint continued to reject unauthenticated requests with HTTP 401, and its CORS preflight returned HTTP 204.
- No project URL, Cloudflare binding, Hyperdrive configuration, or application secret required modification because the project references and database hosts did not change.

## Billing effect

The Supabase transfer preview reported an additional USD 10 per month for each transferred project because the target Pro organization already had active projects. The expected incremental compute cost is therefore approximately USD 20 per month for Development and Staging together, before usage overages or optional add-ons.

## Security follow-up completed

Leaked-password protection was enabled for the email provider in both Development and Staging after transfer. Fresh Security Advisor checks no longer report the leaked-password warning in either project. The remaining informational private-schema `RLS enabled, no policy` notices are expected because browser roles intentionally have no direct access to private application tables.
