# Pre-Development Foundation

## Purpose

This pack converts the locked functional specification and approved UI handoff into an implementation-ready blueprint. It defines boundaries and contracts; it does not create production behavior.

## Locked product decisions

- Product name: HUSTLERO (HCS)
- `docs/PROJECT_SPEC.md` preserves the earlier locked heading `HUSTLER CENTRAL SYSTEM (HCS)` verbatim. In implementation and new documentation, the current product name `HUSTLERO (HCS)` takes precedence; this naming update does not alter the specification's business rules.
- Initial market: Philippine SMEs and branch-based retail operations
- Currency baseline: PHP
- Architecture: multi-tenant modular monolith with separate web, Back Office, POS, Admin, and API deployments
- Transactional data: Supabase PostgreSQL
- Identity: Supabase Auth with application-managed tenant memberships and permissions
- Edge compute and delivery: Cloudflare Workers
- Files: Cloudflare R2 behind the shared File Service
- Background processing: Cloudflare Queues and scheduled Worker triggers where justified
- Source control and CI: GitHub and GitHub Actions
- Inventory and financial truth: append-only ledgers with derived summaries

## Recommended MVP assumptions

These are implementation defaults unless the owner records an override before the affected slice begins:

- General retail is the first fully supported workflow.
- The system is PHP-first and timezone-aware.
- Reports are VAT-ready, but the MVP must not be marketed as BIR-accredited until a separate compliance program is completed.
- MVP payment methods record cash, manual e-wallet, bank transfer, and external card-terminal outcomes. Direct payment-provider charging is deferred.
- POS is online-first. Durable offline sale capture is a later controlled module after conflict rules are approved.
- Negative inventory is blocked by default.
- Costing uses moving weighted average and snapshots COGS on completed sales.
- Subscription entitlements exist in MVP; automated recurring billing can follow the pilot.
- Sensitive refunds, voids, price changes, discounts, cash-outs, and stock adjustments are policy-driven and auditable.

## Foundation deliverables

| Deliverable | File | Status |
| --- | --- | --- |
| Locked functional specification | `docs/PROJECT_SPEC.md` | Imported |
| Approved UI handoff | `docs/UI_HANDOFF.md` | Imported |
| Architecture | `docs/architecture/SYSTEM_ARCHITECTURE.md` | Draft complete |
| MVP and acceptance criteria | `docs/product/MVP_SCOPE.md` | Draft complete |
| Database and RLS blueprint | `docs/database/DATABASE_BLUEPRINT.md` | Draft complete |
| Permission and security model | `docs/security/PERMISSIONS_AND_SECURITY.md` | Draft complete |
| API contract map | `docs/api/API_CONTRACTS.md` | Draft complete |
| Environments and deployment | `docs/operations/ENVIRONMENTS_AND_DEPLOYMENT.md` | Draft complete |
| QA strategy | `docs/qa/QA_STRATEGY.md` | Draft complete |
| Roadmap and estimates | `docs/ROADMAP.md` | Draft complete |
| Decision register | `docs/DECISIONS.md` | Active |
| Project state | `docs/PROJECT_STATE.md` | Active |

## Blueprint review gate

The owner should review scope, assumptions, risks, architecture, and acceptance criteria. Production development starts only after the exact approval phrase in `README.md` is received.
