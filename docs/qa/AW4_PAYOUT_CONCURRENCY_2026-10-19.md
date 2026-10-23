# AW4 Payout / Register Concurrency Candidate

Status at submission: syntax, formatting, changed-script lint and tracked secret scanning passed locally; actual simultaneous-session tests pending exact-head CI.

## Fixed Scope

Only `scripts/wholesale-credit-concurrency.mjs` is extended. Existing CI-only guard, fixed loopback PostgreSQL target and synthetic fixtures remain unchanged. No hosted credential, migration, user account, financial transaction, Worker deployment or Production access.

The existing fully paid four-unit synthetic invoice yields PHP 1,800 customer credit. Open a synthetic register with PHP 2,500. Validate these overlapping transactions using three independent PostgreSQL sessions and observed lock waits, not sleeps as a substitute for overlap:

1. First payout PHP 1,200 succeeds; competing different-key PHP 1,200 payout blocks and then fails with `HCWR4` because only PHP 600 credit remains.
2. Two same-key PHP 1,200 requests reconcile to the original payout, with one effect.
3. Remaining PHP 600 payout holds the register-session lock; close waits, then computes PHP 700 expected/counted cash and zero variance. A historical original-key retry after close returns its prior result without another payout.
4. A new PHP 450 credit note uses a second PHP 1,000 register session. Close commits first; concurrent new refund blocks and then fails with `HCWR2`. Credit remains PHP 450 and closed-session cash is untouched.

Final independent assertions: exactly two payout records totalling PHP 1,800; two matching cash movements totalling PHP -1,800; matching two audit and outbox events; zero persisted denied-command keys; no open registers/variance; source credit balances PHP 0 and PHP 450; fund ledger sum unchanged. Original AW3 and AW4 return/application concurrency scenarios run before this batch and must also pass.

This covers these cash payout/register interactions, not every fund-allocation, external-payment or authorization-revocation race. Authenticated populated UI/recovery and independent review remain separate gates. No hosted Staging or Production readiness is established by submission.
