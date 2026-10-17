# Release Integration - 2026-10-17

## Scope And Source

Owner requested AW3 release, category automatic pricing and payment-reference/report closeout, with functional and computation QA before AW4. The same-day target does not waive release gates or make unfinished features ready.

Working branch: `codex/release-integration-20261017`, based on reviewed-fix candidate `4cdb0061836f2e1a3ba34c4e0411f1761d0d0b53`, with local merge of payment-reference candidate `b85943691631d40fc25036e69ff16912274707ee`. Frozen PRs #1/#2/#3 and main were not changed. This is not a live deployment or merge approval.

## Sales Branch Correction

New ordered migration `20261017065946_sales_branch_access_scope` preserves the existing receipt/reversal calculation cores behind private scoped entry points. Both archive and legacy lists filter allowed locations before the limit. POS and wholesale detail require current active membership, capability and allowed location. Missing, foreign-tenant and unassigned sale IDs have uniform not-found responses after capability validation. Owners retain historical own-branch reads.

Refund/void revalidates current capability and location after acquiring the existing idempotency lock and before reading a cached response. A stored reversal cannot be replayed against another sale ID, even when the old body hash is identical. Original cash/register/remaining-quantity/money/append-only logic remains in the private core. New private functions are not executable by public, anon, authenticated or Hyperdrive roles.

Regression coverage added: three POS detail entry points, archive/legacy lists, scoped wholesale detail and pre-limit pagination, denied refund/void with unchanged full ledger/payment/stock/idempotency snapshots, assigned refund calculation, exact retry, reassignment and inactive-employee retry denial, inactive branch and owner historical read, cross-tenant access and private-core grants. HTTP regressions check safe 403/404/409 mapping.

## Verification Status

- Local formatting/lint/typechecks passed; full test/build command is still running at this checkpoint.
- Local Docker is unavailable. SQL migration/reset/regression execution must run in the existing disposable GitHub CI database job, not a shared Staging or Production database.
- No SQL pass, CI result, new concurrency proof, authenticated UI UAT or deployment is claimed at this checkpoint.

## Remaining Gates

1. Finish local checks and exact candidate CI, including fresh database reset and existing concurrency suite; investigate every failure.
2. Finish independent review of the historical baseline and integration changes before reviewed main incorporation.
3. Implement category settings/contracts/server-authoritative pricing/per-line receipt snapshots/POS repricing and computation regressions. Automatic Dealer precedence is not silently assumed; explicit mode resolution is requested from the owner.
4. Finish wholesale reference capture and agreed receiving-bank/report coverage. Last-four digits are reconciliation hints, not proof of settlement or a globally unique transaction ID. Do not invent automatic matching or move funds.
5. Reviewed-main Staging release, bounded authenticated functional/computation UAT, reconciliation, then exact approved Production migration and coordinated compatible applications. Credential creation/use remains separately gated.

Rollback must retain all payment reference rows and append-only business truth. Do not restore the old unscoped Sales entry points as a casual rollback; pause affected operations and use a reviewed forward correction. Do not deploy an old POS client against a newly enforced reference validator without the documented checkout cutover.
