# HUSTLERO (HCS)

HUSTLERO (HCS) is a multi-tenant business operating system for Philippine SMEs, retailers, wholesalers, resellers, cafes, and multi-branch businesses.

The product combines a branch-ready POS, inventory control, sales reporting, customers, purchasing, finance, approvals, audit, subscriptions, and platform operations while preserving one inventory truth and one sales truth per tenant.

## Current status

The project is in **Phase 1 - Platform Skeleton**. The blueprint is approved, the approved UI source is imported, the monorepo and API foundations are active, and the first tenancy migration is versioned but not applied to any remote environment.

Read these documents before making changes:

- [Locked product specification](docs/PROJECT_SPEC.md)
- [Foundation index](docs/FOUNDATION.md)
- [System architecture](docs/architecture/SYSTEM_ARCHITECTURE.md)
- [Authentication and database connectivity](docs/architecture/AUTH_AND_DATABASE_CONNECTIVITY.md)
- [MVP scope](docs/product/MVP_SCOPE.md)
- [Database blueprint](docs/database/DATABASE_BLUEPRINT.md)
- [Permissions and security](docs/security/PERMISSIONS_AND_SECURITY.md)
- [API contract map](docs/api/API_CONTRACTS.md)
- [Environment and deployment strategy](docs/operations/ENVIRONMENTS_AND_DEPLOYMENT.md)
- [QA strategy](docs/qa/QA_STRATEGY.md)
- [Roadmap](docs/ROADMAP.md)
- [Project state](docs/PROJECT_STATE.md)

## Local development

Use Node.js from `.nvmrc`, then install and verify the workspace:

```bash
npm install
npm run check
```

Start an individual application with `npm run dev:web`, `npm run dev:backoffice`, `npm run dev:pos`, `npm run dev:admin`, or `npm run dev:api`.

The Cloudflare compatibility builds are available through `npm run build:cloudflare`. A Docker-compatible runtime is required before running `npx supabase start`, `npx supabase db reset`, or the database test suite locally; the same database checks also run in GitHub CI.

## Repository

- GitHub: `https://github.com/scaleopsph-max/hustlero-hcs`
- Visibility: Public
- Default branch: `main`
- Current Supabase project: `HUSTLERO (HCS)` in Southeast Asia (Singapore)
- Cloudflare account: ScaleOps account; HUSTLERO Workers are intentionally not created yet

Never commit credentials, access tokens, database passwords, service-role keys, private customer data, or production exports.
