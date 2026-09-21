# HUSTLERO (HCS)

HUSTLERO (HCS) is a multi-tenant business operating system for Philippine SMEs, retailers, wholesalers, resellers, cafes, and multi-branch businesses.

The product combines a branch-ready POS, inventory control, sales reporting, customers, purchasing, finance, approvals, audit, subscriptions, and platform operations while preserving one inventory truth and one sales truth per tenant.

## Current status

The project is in **Pre-Development Foundation**. The functional specification and UI direction are approved inputs, but no production feature implementation, database migration, or Cloudflare deployment has started.

Read these documents before making changes:

- [Locked product specification](docs/PROJECT_SPEC.md)
- [Foundation index](docs/FOUNDATION.md)
- [System architecture](docs/architecture/SYSTEM_ARCHITECTURE.md)
- [MVP scope](docs/product/MVP_SCOPE.md)
- [Database blueprint](docs/database/DATABASE_BLUEPRINT.md)
- [Permissions and security](docs/security/PERMISSIONS_AND_SECURITY.md)
- [API contract map](docs/api/API_CONTRACTS.md)
- [Environment and deployment strategy](docs/operations/ENVIRONMENTS_AND_DEPLOYMENT.md)
- [QA strategy](docs/qa/QA_STRATEGY.md)
- [Roadmap](docs/ROADMAP.md)
- [Project state](docs/PROJECT_STATE.md)

## Approval gate

Development begins only after the owner sends:

`APPROVED BLUEPRINT - PROCEED TO BUILD`

Until then, changes are limited to discovery, architecture, planning, documentation, and non-production validation.

## Repository

- GitHub: `https://github.com/scaleopsph-max/hustlero-hcs`
- Visibility: Public
- Default branch: `main`
- Current Supabase project: `HUSTLERO (HCS)` in Southeast Asia (Singapore)
- Cloudflare account: ScaleOps account; HUSTLERO Workers are intentionally not created yet

Never commit credentials, access tokens, database passwords, service-role keys, private customer data, or production exports.
