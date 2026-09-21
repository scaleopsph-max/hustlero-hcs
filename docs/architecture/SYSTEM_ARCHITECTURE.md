# System Architecture

## Architecture style

HCS starts as a TypeScript modular monolith. Domain modules have explicit boundaries but deploy together where operationally sensible. This keeps transactions, debugging, and delivery straightforward while preserving a path to extraction if scale later proves it necessary.

```text
Clients
├── Marketing Web
├── Tenant Back Office
├── POS
└── HCS Super Admin
        |
        v
Cloudflare API Worker
├── Authentication context
├── Tenant and authorization enforcement
├── Catalog and pricing
├── Inventory
├── Registers and sales
├── Customers
├── Approvals and alerts
├── Subscriptions and entitlements
├── Audit and event outbox
└── Reporting queries
        |
        v
Supabase PostgreSQL + Auth
        |
        +--> Cloudflare R2: tenant files
        +--> Cloudflare Queues: secondary work
```

## Planned monorepo

```text
apps/
  web/
  backoffice/
  pos/
  admin/
  api/
packages/
  ui/
  config/
  contracts/
  domain/
  database/
  testing/
supabase/
  migrations/
  tests/
docs/
```

## Runtime decisions

- Frontends remain React-based. The approved Next.js prototype must be upgraded from its vulnerable Next.js 14 baseline before adoption.
- Cloudflare currently recommends the vinext path for Next.js on Workers, but it is beta. Phase 1 begins with a compatibility spike against the approved prototype. A failed spike triggers a documented fallback decision, not a forced migration.
- The API uses a Worker-native framework such as Hono rather than NestJS. Domain services stay framework-independent.
- PostgreSQL is the transactional source of truth. Redis, queues, caches, and browser storage are never business truth.
- Zod schemas define request validation and feed shared TypeScript contracts.
- Database access is SQL-first or uses a lightweight typed query layer that supports transactions, PostgreSQL constraints, and the Cloudflare runtime.

## Deployment units

Each deployment has its own Cloudflare project and configuration:

| Application | Worker name | Primary responsibility |
| --- | --- | --- |
| Web | `hustlero-hcs-web` | Public marketing and signup entry |
| Back Office | `hustlero-hcs-backoffice` | Tenant management application |
| POS | `hustlero-hcs-pos` | Register and sales operations |
| Admin | `hustlero-hcs-admin` | HCS platform operations |
| API | `hustlero-hcs-api` | Central business logic and integrations |

The same Git repository can connect to each Worker. Each Worker must define a root/config path and watch paths so unrelated changes do not trigger every deployment.

## Request context

Every authenticated API request resolves a trusted server context:

```text
requestId
actorType
userId
tenantId
employeeId
locationIds
activeLocationId
deviceId
permissions
entitlements
```

The API rejects client attempts to choose a tenant outside the authenticated membership. Location switching is validated against server-side assignments.

## Critical transaction boundaries

- Sale completion: sale, sale items, payment records, COGS snapshot, stock movements, cash movement, audit event, and outbox events.
- Refund: refund record, payment reversal state, stock reversal policy, loyalty reversal, audit event, and outbox events.
- Purchase receipt: goods receipt, cost capture, stock movements, balance projection, and audit event.
- Transfer dispatch and receive: state transition, source/destination movements, in-transit accounting, discrepancy evidence, and audit event.
- Register close: counted cash, expected cash, variance, approval result, close state, alert, and audit event.

Secondary actions such as emails and exports consume outbox events after the critical transaction commits.

## Feature resolution

```text
platform available
AND tenant entitled
AND tenant enabled
AND employee permitted
= usable capability
```

The API is authoritative. UI navigation reflects the result but does not enforce access by itself.
