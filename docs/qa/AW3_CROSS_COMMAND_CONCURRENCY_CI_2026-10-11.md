# AW3 Cross-Command Concurrency Candidate

Date: 2026-10-11

## Candidate scope

Includes prior approval/revocation UI and order-action selection/recovery work, plus six cross-command scenarios added to the existing thirteen independent-session scenarios in `scripts/wholesale-credit-concurrency.mjs`.

1. Payment commits before competing confirmation at the current credit limit; confirmation must see released invoice debt and reserve once.
2. Confirmation holds credit locks before payment; both commands commit, preserving remaining reservation exposure and paid invoice balance.
3. Opening commits while payment waits on the customer lock; one immutable opening and one receipt allocation, zero final debt. Opening replay returns the original charge.
4. Payment against unknown legacy debt is rejected and its header rolls back. An outer fixture customer lock/savepoint demonstrates overlapping opening; payment can then retry the original uncommitted key after classification.
5. Cancellation remains uncommitted while an issued-invoice payment finishes independently; only remaining reservation is released.
6. Payment remains uncommitted while cancellation finishes independently; previously fulfilled units and receipt allocation are preserved.

Every fixture reconciles exact exposure/balance, one payment/allocation/audit/outbox, immutable opening counts where applicable, and cancellation reservation-ledger counts. Shared inventory finishes at 12 on hand and zero reserved. Cleanup releases held transactions before closing blocked clients.

## Verification state

Syntax and focused formatting passed. Prior UI increments passed full local application builds and synthetic browser tests with 484 unit cases. Docker is not installed locally, so no local database execution is claimed. Full isolated GitHub CI, fresh migration reset, pgTAP and all nineteen concurrency scenarios remain pending.

No new schema/API or live migration, payment, opening entry, stock/fund movement, Staging deployment or Production command.
