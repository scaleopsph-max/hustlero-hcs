# AW4 Return/Credit Recovery Gate

Unreleased runbook for the local candidate; not execution authorization.

## Before Promotion

Resolve the AW3 release gate first. Confirm exact migration inventory, clean reviewed source, supported execution path, fresh backup and independently verified restore evidence. Apply only the environment-specific approved inventory. Do not append AW4 to the previously approved fifteen AW3 migrations.

Test returns, credit application, payouts, statements, closing debt, stock/cost and funds together. Stop checkout and mutation traffic during any incompatible coordinated release. Keep a known compatible API/Back Office build available, with diagnostic controls disabled.

## Failure Before Business Posting

Stop new AW4 commands. Reconcile migration history and schema before retrying anything. An uncertain apply is not permission to resend. Preserve the additive private tables even if empty unless a separately reviewed corrective migration establishes a safe removal. Do not roll back existing AW3 migrations to remove AW4.

## Failure After Business Posting

Do not drop, truncate, update or delete credit notes, credit lines, issues, applications, payouts, inventory movements, funds, audit or outbox history. Do not restore a database snapshot over newer real transactions as a routine application rollback.

Disable new AW4 mutation entry points using a reviewed coordinated release. Retain readers capable of accounting for posted notes/applications/payouts; an older AR reader that ignores credit notes is not a safe fallback. Do not revoke shared advanced-wholesale access merely to hide an AW4 fault without explicit impact review.

Preserve pending original keys/bodies. Reconcile each outcome with authorized command history and independent ledger counts. Unknown outcomes must retain the original command, not create a replacement key. Correct financial errors only through a separately reviewed append-only corrective command or forward migration with explicit authorization.

Funded payouts stay blocked until a separate audited fund-reversal workflow exists. Never auto-decrement Capital/Operating balances. External payout records are not evidence that a bank/provider transfer occurred; obtain the actual settlement evidence before recording one.

## Restore Decision

For genuine disaster recovery, use an isolated restore first and reconcile business records, keys, ledger totals and recovery-point loss. Production restore, resource creation and destructive recovery-copy cleanup require explicit scopes. Record the accepted recovery point and downtime before a cutover. This document does not approve any such operation.
