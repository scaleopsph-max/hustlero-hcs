# Wholesale Payment Reference Candidate

## Scope

Extends the POS reference slice to wholesale collections and COD/Prepaid paid fulfillment. New bank-transfer and e-wallet receipts require exactly four ASCII reference digits, preserving leading zeroes. Cash and external-card rules are unchanged. The existing `reference` field carries these four digits for online wholesale receipts; the payload shape and historical pending command identity are not silently replaced.

The server checks the actual active tenant payment method, not a browser-supplied type. Validation occurs after the existing completed-replay path. New immutable private/RLS reference rows snapshot method name, type and last four digits atomically with the receipt. A failure during paid fulfillment rolls back the invoice, charge, stock delivery, receipt, references, audit and outbox together. Existing customer-before-command-key lock ordering is retained. Repeated last-four digits are allowed for separate transactions; they are not unique payment identities or settlement evidence.

The dedicated `HCAP6` rejection is a definitive non-posting reference error. Both wholesale entry forms can correct that rejected command. Authorization failures, unknown outcomes and idempotency conflicts retain the original command for recovery. Completed historical retries do not retroactively create a reference snapshot.

## Bank/Wallet Reports

- POS: `/reports/payments`, existing POS-only endpoint retained.
- Wholesale: `/reports/payments/wholesale`, separate read-only endpoint. Requires Reports plus existing Wholesale read/entitlement checks, current tenant membership and branch scope.
- Report grouping is per configured payment method (for example separate GCash/BDO/BPI methods), with immutable method labels separated after a rename. Dedicated receiving-account configuration and statement matching are not implemented or claimed by this candidate; owner scope question remains separate.
- Wholesale reports contain whole receipts, once per payment, not one full amount per invoice allocation. A restricted user cannot see a receipt if any allocated invoice belongs to an unassigned branch. A single-branch filter excludes mixed-branch/unallocated receipts, even for an owner; it never relabels a full mixed amount as belonging to one branch. Owners can view those whole receipts under All permitted branches.
- Amounts and grouped totals use exact numeric/BigInt minor units. Reports are bounded to 32 inclusive tenant-timezone dates and at most 10,000 rows, with a bounded 10,001-row overflow check rather than silent truncation. Historical rows without a snapshot show Not recorded; no digits are guessed from old free text. Legacy method labels/types necessarily use current metadata where no historical snapshot exists.
- Export uses the same shared CSV formula guard as General Reports, including whitespace/control-prefix attacks. Leading zeroes are exported as reference text. Displayed records/CSV say Unverified, never Matched or Settled. No automatic fund allocation, bank transfer, register cash movement or actual external payment processing is introduced.

## Verification And Release

Migration: `20261017072421_wholesale_payment_references`. Test scope covers collection validation/replay/snapshots, COD/Prepaid full rollback, report method totals and whole-receipt branch visibility. Focused unit cases passed before final CSV hardening; final full checks and disposable migration CI must be independently verified. No shared Staging/Production migration, credential, access grant or live transaction is part of local/CI verification.

Coordinate migration/API/Back Office/POS and close stale checkout sessions before enabling the new reference validator. Preserve the reference tables and append-only truth during rollback. Do not roll back to clients that submit unsupported reference formats against the new validator. Authenticated Staging UAT and reviewed-main/explicit Production gates remain outstanding until separately executed and recorded.
