# Staging Recovery Drill - 2026-10-02

## Result

Pass. The drill-only recovery project was deleted after owner confirmation.

## Database restore

- Source: `HUSTLERO HCS Staging` (`sdfwdhbryjyfufgtfqmf`)
- Backup: physical backup from `2026-10-01 16:03:50+00`
- Recovery project: `HUSTLERO HCS Recovery Drill 2026-10-02` (`fliglpvhqtkstpnczfnq`)
- Region: Singapore (`ap-southeast-1`)
- Final status: `ACTIVE_HEALTHY`
- Isolation: no Worker, Hyperdrive, web application, queue, or external job was attached

Structural comparison matched the source: 47 migrations with latest version `20260928140928`, 58 `app` tables, 7 `platform` tables, 1 `audit` table, 1 `integration` table, 130 business routines, 67 RLS-enabled tables, 13 policies, 1 Auth user, and zero unvalidated constraints.

All 57 business tables carrying `created_at` matched the source row counts exactly at the backup cutoff. Recovered data also passed these integrity checks:

- Inventory balance versus movement-ledger mismatches: 0
- Sale subtotal versus line-total mismatches: 0
- Sale total versus payment-total mismatches: 0
- Refund total versus refund-item mismatches: 0
- Closed-register variance mismatches: 0
- Tenant-membership/Auth-user orphans: 0
- Tenant-scoped rows with a null tenant ID: 0
- Recovered tenants represented in inventory and sales: 1

The recovery project reported the established informational private-schema RLS-without-browser-policy notices. Clone-only Auth warnings for leaked-password protection and insufficient MFA options are expected because Supabase does not copy Auth settings; the recovery project was never connected to an application.

## Worker rollback

- Worker: `hustlero-hcs-api-staging`
- Release candidate: `1f099099-8a16-4203-9b7d-610e99c9885a`
- Previous known-good version: `286f8d46-b29d-46de-8c27-22635a6cbb95`
- Controlled rollback: previous version received 100% traffic
- Drill completion: release candidate restored to 100% traffic

Before rollback, during rollback, and after restoration:

- `GET /health`: 200
- Unauthenticated `GET /v1/me`: 401
- Back Office-origin CORS preflight: 204 with the exact allowed origin

No bound resource or database migration was changed by the Worker rollback.

## Follow-up

The owner explicitly confirmed deletion, Supabase reported successful removal, and the organization returned to its four original projects. Run the final repository verification and release-security checks before requesting production approval.

