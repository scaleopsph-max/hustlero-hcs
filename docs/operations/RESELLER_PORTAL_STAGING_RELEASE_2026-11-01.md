# Reseller Portal Staging Release: November 1, 2026

Owner requested the reseller portal work (R1 through tiers) on Staging so others can test it. Target is Staging only;
Production stays a separate, later approval.

## Candidate

- Branch `codex/files-product-images-payment-proofs` (PR #14, stacked on PR #13), head verified by CI (fresh database
  replay, all pgTAP suites, unit tests, builds).
- Staging last recorded 65 migrations ending `20261012152656_reporting_branch_read_scope` (Oct 19 preflight). This
  release applies the 37 committed migrations after it, `20261016025304` through `20261101210000_reseller_tiers`,
  including the AW3/AW4 branch-scope, return-credit and fund-reversal migrations the reseller portal depends on.
  The dry run is the source of truth: stop if it lists anything else.

## New Staging configuration

| Item                                                | Value                                                                                         |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| API var `RESELLER_ORIGIN`                           | `https://hustlero-hcs-reseller-staging.scaleopsph.workers.dev` (in `apps/api/wrangler.jsonc`) |
| R2 bucket                                           | `hustlero-hcs-files-staging` (private; create if missing)                                     |
| API secret `FILES_URL_SECRET`                       | Random 48 bytes, set by the owner, never printed or committed                                 |
| API secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `npm run push:keys -- staging`                                                                |
| API cron                                            | `*/5 * * * *` (already in the staging config)                                                 |
| Reseller portal Worker                              | `hustlero-hcs-reseller-staging` (new)                                                         |
| Back Office build var                               | `NEXT_PUBLIC_RESELLER_PORTAL_URL` = reseller staging URL                                      |
| Supabase Auth redirect                              | `https://hustlero-hcs-reseller-staging.scaleopsph.workers.dev/**`                             |
| Tenant entitlements                                 | Advanced wholesale and Reseller portal on for the UAT business                                |

## Order

1. Link the CLI to Staging, dry run, review, push; link back to Development.
2. Storage and secrets (R2 bucket, `FILES_URL_SECRET`, push keys).
3. Deploy the API (`--env staging`) and smoke-test health 200, `/v1/portal/tier` 401, reseller-origin CORS.
4. Build and deploy Back Office, POS and the reseller portal with staging-only public variables and explicit
   `--name <app>-staging` (vinext ignores `--env`).
5. Supabase Auth redirect for the portal; entitlements for the UAT business; owner turns the portal on.
6. UAT with generated businesses and resellers only.

## Rollback

API and web apps: `wrangler rollback <previous-version-id> --name <worker>` (see RECOVERY_RUNBOOK.md). Database: the
migrations are forward-only; restore from the Staging backup if a migration must be undone.
