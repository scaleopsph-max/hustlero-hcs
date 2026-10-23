# AW4 Review Fixes - October 21, 2026

## Scope

Owner authorized continuous reproduction, correction, regression QA and one
independent read-only re-review, stopping after these three items. No hosted
migration, deployment, credential creation, access grant or financial UAT is
authorized by this batch. Main and the previously approved fifteen AW3 migration
files remain unchanged. AW4's additional, uninstalled migration is edited only
in the candidate branch.

## Reproductions

- Queued authorization regression committed as
  `0ad670535218fa8a38728830d98a548214225349`. Push CI `39518361813` executed
  independent PostgreSQL sessions: after suspension committed, the old credit
  application returned success instead of `HCWR0`. Previous AW3/AW4 races passed
  before that new assertion failed. This is an executed failing-before case.
- An isolated PGlite/PostgreSQL 17 test started a transaction, delayed it, and
  posted a paid restocking return. The original reversal, note, credit issue and
  inventory event timestamps differed. The identical assertion passed after the
  fix. The full local candidate suite subsequently passed 25 reported tests.
- Baseline CI also discovered a new high Vite advisory. All four app pins and
  the shared dependency override now select 8.3.4. The unchanged dependency
  policy passed locally; no new advisory exception was added.

## Corrections

Private AW4 guards lock active tenant, platform feature, entitlement, membership
and non-owner read/action permission rows with shared row locks. They serialize
revocation against command admission. Guards recheck wall-clock entitlement
expiry after business/advisory waits, including original-key replay. A command
that wins admission can finish atomically before a queued suspension commits;
a revocation that wins admission must deny the command without ledger writes.

Independent interim re-review identified the same admission issue for branch
scope during inventory waits. A private location guard now holds active location
and, for non-owners, active employee and assignment rows through command end.
Owner bypass does not bypass location activity or tenant/feature availability.

Returns acquire stock locks in stable variant order before selecting one server
`clock_timestamp()` effective time. Reversal, note, refund items, credit issue,
stock event, audit and outbox explicitly use that time. Application/payout events
also share an effective time with their audit/outbox and cash movement. Replay
returns the immutable original result and never re-dates or reposts history.

## Regression Coverage

- Revocation-first tenant suspension, entitlement disable and membership
  deactivation against queued return, application and payout.
- Non-owner action permission, branch assignment, employee activity and location
  activity revocation against queued return/application.
- Actual entitlement expiry during customer-lock wait, including replay.
- Command-first suspension ordering, with suspension waiting for atomic posting.
- Actual inventory-lock wait followed by a common effective timestamp across
  linked events; strict as-of cutoff, Manila business date and payout/cash event
  alignment. This does not claim an actual wait across midnight or a changed
  system clock.
- Existing valuation, overdraw, idempotency, cash close, shared-stock, funds,
  tenant/branch isolation, API and recovery UI tests remain required.

## Verification Status

Local disposable suite: 25/25 reported tests passed. Dependency gate passed with
only the previously documented exceptions. Full updated local checks, exact-SHA
CI database/reset/concurrency runs and final independent re-review are pending
at this source checkpoint; record their actual results before closeout.

This document is not a hosted acceptance report or release approval. AW3's
existing execution restriction and separate Staging/Production gates remain.
