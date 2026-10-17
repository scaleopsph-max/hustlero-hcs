# Production Basic Wholesale Release

Date: 2026-10-05

Environment: Production

Supabase project: `gmprhuzbisfylidjpfob`

## Approval and scope

The owner explicitly approved `CONFIRM APPLY PRODUCTION WHOLESALE MIGRATION AND DEPLOY`. This release promotes the Staging-validated Basic Wholesale foundation to Production. It does not create a Production wholesale or dealer price list, alter the live retail price, post a sale, or move inventory.

Retail, Wholesale, and Dealer continue to consume the same tenant, location, and product-variant inventory balance. Price selection remains server-authoritative, reseller-gated, tenant-scoped, and quantity-threshold controlled.

## Database release

- A Production dry run identified exactly one pending migration: `20261003055709_wholesale_pricing_foundation.sql`.
- The migration was applied once with seeds, role changes, and Vault updates excluded.
- The Production migration ledger now contains 48 matching local/remote migrations ending with `20261003055709`.
- The Supabase Security Advisor returned no warning- or error-level findings.
- The Supabase Performance Advisor returned no error-level findings.

## Application release

- API Worker `hustlero-hcs-api` deployed as version `5c82d179-84bb-4145-8055-bd826da7cfaa` with the existing Production Supabase URL, Production Hyperdrive binding, and exact Production application origins.
- Back Office Worker `hustlero-hcs-backoffice` deployed as version `a8753db5-c0c1-4e93-8091-3ffd78f2dadc`.
- POS Worker `hustlero-hcs-pos` deployed as version `9ea9e392-1e58-4de7-80e7-55492b62c032`.
- The Back Office artifact contained 44 Production Supabase references and 44 Production API references, with zero Staging or Development references.
- The POS artifact contained 4 Production API references, with zero Staging or Development references.

## Verification

- Production API `GET /health` returned `200` with environment `production`.
- Unauthenticated `GET /v1/me` returned `401`.
- Back Office and POS CORS preflights returned `204` with their exact allowed origins.
- Production Back Office `/pricing` and Production POS `/sell` returned `200`.
- The authenticated owner session loaded `SAH RESTORATION` and the Wholesale Pricing workspace.
- The workspace correctly reported that no Production wholesale or dealer price list exists yet.
- No Production sale, refund, loyalty entry, register movement, or inventory movement was posted during this release.

## Credential handling

A short-lived Supabase CLI token was created only for the migration workflow. It was not written to the repository or an environment file. The token was revoked immediately after deployment verification, and the Supabase account token list was verified to show `No access tokens found`.

## Result

The Production Basic Wholesale foundation is deployed and smoke-verified. Live retail behavior remains available and the shared-inventory architecture is in place. Business activation remains intentionally incomplete until Production price lists, reseller assignment, and controlled sale/refund validation are explicitly approved and completed.
