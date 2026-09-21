# HUSTLERO Engineering Rules

## Source of truth

1. `docs/PROJECT_SPEC.md` defines product behavior.
2. `docs/UI_HANDOFF.md` defines the approved visual direction and known prototype limitations.
3. The architecture, database, security, API, QA, and roadmap documents translate the specification into implementation rules.
4. `docs/PROJECT_STATE.md` records the current phase, verified work, blockers, and next safe action.

When documents conflict, stop and record the conflict in `docs/DECISIONS.md`. Do not silently invent a business rule.

## Approval gate

Do not write production feature code, apply database migrations, create live Cloudflare deployments, or connect production secrets before the owner sends `APPROVED BLUEPRINT - PROCEED TO BUILD`.

## Engineering doctrine

- Preserve strict tenant isolation in the API and database.
- Derive tenant context from authenticated server context, never a client-supplied tenant ID.
- Treat inventory movement ledgers, fund ledgers, loyalty ledgers, audit events, and event outbox rows as append-only business truth.
- Use reversals, corrections, cancellation, archival, or deactivation instead of destructive deletion.
- Keep money as integer minor units in TypeScript and `numeric` in PostgreSQL. Never use floating point for financial values.
- Store timestamps as `timestamptz` and define business-day boundaries per tenant/location timezone.
- Make critical commands atomic and idempotent.
- Enforce authorization server-side and use PostgreSQL RLS as defense in depth.
- Keep Super Admin authentication and sessions separate from tenant Back Office sessions.
- Never expose Supabase secret/service-role keys or Cloudflare credentials to browser bundles.
- Use reversible, ordered migrations and verify restore procedures.

## Delivery rules

- Build vertical slices: schema, domain rules, API, authorization, UI, tests, and documentation.
- Run lint, format, typecheck, unit, integration, migration, tenant-isolation, and build checks before merge.
- Add regression coverage for every corrected defect.
- Do not claim a test, push, or deployment passed unless it was executed and verified.
- Do not push directly to production from an unverified local state.
- Preserve user changes and avoid unrelated refactors.

## Public repository safety

- Use `.env.example` for variable names only.
- Keep local secrets in ignored files.
- Sanitize logs, fixtures, screenshots, exports, and database dumps.
- Run secret scanning before every push.
