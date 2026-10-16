# Online Payment Reference And Report: POS Slice

Status: local implementation under verification; no shared/live migration or release. Independent branch/worktree based on 4413dd6; existing AW3 PR #1 and original dirty evidence tree remain untouched.

## Implemented Scope

- POS wallet and bank-transfer allocations require exactly four ASCII digits, retained as text including leading zeros. Cash/card/other are not guessed to be online methods.
- API contract retains the suffix in the canonical request, so idempotency hash includes it. Database validates the actual tenant payment-method type, not a client method label.
- Atomic wrapper retains original sale command authorization, session/device checks, locks, monetary validation, shared-stock and idempotency behavior. New immutable side records capture suffix and method name/type snapshots. Original core is private, not callable by Hyperdrive/browser roles.
- Completed pre-migration retries remain replayable without inventing references on historical payments. Suffix is not unique across transactions.
- Read-only POS bank/wallet report supports date/assigned-branch/payment-method filters, payment/reversal/net-recorded method totals and CSV. Owner/reports.read permission and active assigned-branch filtering happen server-side. Historical missing references remain Not recorded. All settlements remain Unverified; a reference is not proof of received money.

## Not Implemented In This Slice

Wholesale payment/paid-fulfillment reference capture, receiving-bank-account configuration/snapshots, matched/discrepancy confirmation history, bank statement imports/automatic matching and bank-specific reconciliation controls remain follow-up work. Do not call this complete bank reconciliation. Existing fund-allocation settlement attestation remains separate. No automatic transfer, fund posting, receipt rewriting or historical reference backfill.

Category-based automatic pricing remains a separately locked pending increment; this slice does not implement it.

## Rollout And Validation

Migration 20261016025304 created by pinned CLI migration-new command; one additive reference table, private preserved core plus validated wrapper, scoped report reader. Prior data is untouched. Rollout must coordinate API/POS deployment and migration in an approved operating window: old POS clients cannot provide newly required wallet/transfer suffixes. Do not silently apply enforcement to a running shift. Schema rollback is not destructive deletion of references; preserve captured history and restore a reviewed compatible command only if required.

No Docker runtime exists locally. SQL fixture tests require disposable CI before any environment install; TypeScript/unit checks are separate evidence. Source/read-only reporting behavior must be verified across owner, restricted branch, foreign tenant, missing/invalid suffix, zero prefixes, same-key replay, conflicting changed reference, repeated suffix, cash and legacy replay. No live customer money is authorized by tests.
