# Production Foundation Report

Date: 2026-10-02

## Decision

The approved Staging release candidate has been provisioned as an isolated Production foundation. Infrastructure, database migrations, restricted connectivity, public application bundles, authentication URLs, and baseline security controls are deployed and verified. The controlled owner identity and first setup-stage tenant now exist; live business operations are not yet authorized by this report.

## Provisioned resources

| Component | Resource | Verified state |
| --- | --- | --- |
| Supabase | `HUSTLERO HCS Production` (`gmprhuzbisfylidjpfob`) | Active in Singapore; 47 migrations applied |
| Hyperdrive | `hustlero-hcs-production` (`a611fc9b39974b59a887529621440b6c`) | Restricted login, SSL required, 20 origin connections, cache disabled |
| API | `https://hustlero-hcs-api.scaleopsph.workers.dev` | Version `180681b0-d9f2-4c2c-8b9b-38241c0f2cb1` |
| Back Office | `https://hustlero-hcs-backoffice.scaleopsph.workers.dev` | Version `afaf999e-7c52-4500-bf0a-3d22165c390b` |
| POS | `https://hustlero-hcs-pos.scaleopsph.workers.dev` | Version `c4f70120-2818-4ce8-8a27-2d56528796a8` |
| Super Admin | `https://hustlero-hcs-admin.scaleopsph.workers.dev` | Version `84603dd8-2346-4103-92ff-d5fe99d19457` |

## Verification evidence

- API health returned 200, unauthenticated `/v1/me` returned 401, and Production Back Office/POS CORS preflights returned 204.
- All three public web applications returned 200 after deployment propagation.
- Production bundles reference only the Production Supabase and API origins; scans found no Development or Staging references.
- Database posture contains 67 business tables with RLS enabled, 13 explicit policies, and 130 routines.
- The only unvalidated constraint is Supabase-managed `realtime.messages_payload_exclusive`; no application-schema constraint is unvalidated.
- The Hyperdrive role has login access but is neither superuser nor `BYPASSRLS`.
- The initially generated Hyperdrive password was rotated immediately after accidental terminal-title exposure. The replacement is not present in source control or this report.
- Supabase Auth uses an active asymmetric ECC P-256 signing key.
- Auth site URL is the Production Back Office URL. Back Office and Super Admin Production wildcard redirects are allowlisted.
- Leaked-password protection is enabled. A fresh Security Advisor run reports only 57 `INFO` findings for intentionally policy-free, deny-all private-schema tables; it reports no warning or error.
- Production contains one owner-confirmed Auth identity and one setup-stage tenant, `SAH RESTORATION`, with one active `Main Store / MAIN` location. It contains no catalog, opening inventory, employee, register, POS device, or transaction data.
- The tenant slug is `sah-restoration`. A duplicated leading character introduced by the initial form's auto-slug defect was corrected atomically with exactly one audit and one outbox event.
- The auto-slug regression is covered by unit tests and fixed in Production Back Office version `81742123-7a31-41af-bedb-7d8cdc30faed`; the build passed production-reference isolation, Cloudflare dry run, deployment, HTTP 200, and authenticated setup-state checks.

## Release boundary

The foundation is in controlled bootstrap, not general availability. The next gate requires completion of the tenant setup profile and feature selection, authenticated API checks, catalog and opening inventory, POS activation and guided transaction validation, reporting reconciliation, rollback confirmation, and final go-live approval. Do not copy Staging credentials or generated UAT records into Production.

## Rollback and recovery

Cloudflare Worker deployments are immutable and their previous versions remain available for traffic rollback. Database recovery must follow `docs/operations/RECOVERY_RUNBOOK.md`; application rollback must never be used to reverse destructive schema changes.
