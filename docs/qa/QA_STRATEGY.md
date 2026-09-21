# QA Strategy

## Test layers

| Layer | Purpose |
| --- | --- |
| Unit | Pricing, tax, costing, permission, state transition, and calculation rules |
| Database | Constraints, migrations, RLS allow/deny, ledger invariants, concurrency |
| API integration | Auth context, transactions, idempotency, errors, audit/outbox |
| Component | Shared fields, tables, keypads, dialogs, blocked states |
| End-to-end | Real workflows across Back Office, POS, Admin, and API |
| Security | Cross-tenant, role bypass, injection, secrets, rate limits, uploads |
| Performance | POS lookup, sale completion, reports, large tables, imports |
| Recovery | Network loss, retries, unknown payment state, partial secondary failure |

## Mandatory CI checks

- Dependency install with lockfile integrity
- Format and lint
- Strict typecheck
- Unit and component tests
- Database migration reset and verification
- RLS and tenant-isolation tests
- API integration tests
- Production builds for all applications
- Dependency and secret scan
- Changed-scope E2E smoke tests

## Core end-to-end scenarios

1. Owner onboarding through Ready to Sell
2. Product import and opening inventory
3. Register activation, open, sale, receipt, and close
4. Duplicate sale submission retry
5. Full and partial refund with stock and payment reversal
6. Manager-approved variance and generated alert
7. Cross-tenant and wrong-location access rejection
8. Employee deactivation while preserving history
9. Subscription downgrade with historical access preserved
10. Dashboard/report reconciliation to raw transactions

## Responsive matrix

- Small mobile
- Large mobile
- Portrait tablet
- 1280x800 POS landscape tablet
- Laptop
- Desktop

POS validation includes touch targets, barcode keyboard input, printer failure behavior, blur/rendering performance, visible sync state, and no layout shift during cart updates.

## Quality gates

- No critical or high known dependency vulnerability without a documented, approved exception.
- No failing tenant-isolation or permission test.
- No unresolved critical accessibility violation in core workflows.
- No migration is promoted without clean-environment replay.
- No release proceeds with unresolved unknown transaction outcomes.
- Full QA evidence and rollback point are recorded in `docs/PROJECT_STATE.md` or a linked release report.
