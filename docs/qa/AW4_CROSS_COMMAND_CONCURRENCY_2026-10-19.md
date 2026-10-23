# AW4 Cross-Command Concurrency Candidate

Status at submission: application tests passed locally (838 app and 47 simulated harness cases). New simultaneous PostgreSQL scenarios require exact-head database CI; no concurrency pass is claimed here.

## Scope

Extend only the established CI concurrency script, using its fixed loopback disposable database and three separate sessions. Keep the existing CI-only guard, all preceding AW3/AW4 checks, and observed database lock waits. No shared database, real credential, hosted transaction, deployment or Production access.

## New Overlapping Transactions

1. Apply PHP 300 from an existing PHP 450 credit note; a competing PHP 300 payout must wait and then fail with HCWR4. Only PHP 150 credit remains.
2. Pay out PHP 100 from that remaining credit; a competing PHP 100 application must wait and then fail with HCWR4. Apply the final PHP 50 separately. Reconcile PHP 350 applications plus PHP 100 payout to the original PHP 450 credit, and close the PHP 1,000 register at PHP 900 with zero variance.
3. On the same customer's target invoice, whose original PHP 4,500 charge now has PHP 1,700 credit applications, record PHP 900 payment first. A concurrent one-unit PHP 450 return must wait and then reduce debt to PHP 1,450 without creating customer credit.
4. Return a second PHP 450 unit first. A stale PHP 1,450 payment must wait and fail with HCAP5 because debt is now PHP 1,000. A distinct corrected PHP 1,000 payment settles exactly.

## Independent Reconciliation

Assert original charge PHP 4,500 equals PHP 1,700 applications plus PHP 1,900 receipts plus PHP 900 return credits. Require zero debt and no new customer credit for the two target-invoice returns. Assert two return notes and two payment allocations, three cumulative payout cash movements totalling PHP -1,900, seven matching new command audit/outbox records, no persisted denied-command keys, shared stock at 12 units, no open register and unchanged fund balance.

This closes only the enumerated cross-command race coverage if exact-head CI passes. It does not replace populated authenticated browser tests, independent review, supported AW3 execution resolution, reviewed-main integration, hosted Staging reconciliation or separately approved Production release. AW4 remains outside the approved fifteen AW3 migrations.
