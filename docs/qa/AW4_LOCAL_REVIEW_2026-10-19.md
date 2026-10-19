# AW4 Local Review: October 19, 2026

Status: local working-tree candidate only, not an approved hosted release.
Branch: `codex/aw4-return-credit-foundation`, based on main `2be9c76`.

## Corrections and Evidence

- Fund-allocation wrapper now preserves `HCFD2` validation for malformed, null or non-string payment identities instead of leaking a UUID cast error. Completed original-key replays still delegate to the existing hash-validated core.
- Six API preview regressions cover unpaid, partially paid and fully paid return splits, denied permission, missing scoped invoice and unsupported valuation. Preview invokes the authorized loader and no posting command. Responses are private/no-store.
- Three recovery regressions cover credit applications and cash/external payouts: exact persisted key/body, amount, invoice, method, session and leading-zero reference must match independently authorized history. Missing/mismatched history cannot clear a pending command.
- Wholesale sale receipt now links to Returns and credits. Wholesale commercial credits are labeled separately from POS cash refunds; POS reversal controls remain disabled for wholesale invoices.
- `npm test`: 786 application tests across 42 files and 47 simulated harness tests passed.
- Disposable PGlite/PostgreSQL 17 candidate runner: 23 reported tests passed, including malformed identity/no-write regression and existing credit, stock, funds, as-of, authorization and rollback checks. This is not multi-session concurrency or hosted Supabase verification.
- Formatting and tracked-diff whitespace checks passed. Candidate source secret signatures scanned 435 tracked/untracked files under apps, packages and supabase; no findings. Scanner's inherited console label says tracked files, but the actual supplied inventory included untracked source. This is not a whole-workstation secret scan.
- Persistent pgTAP regression added for malformed fund identity, but not executed here. No Docker/psql runtime has been verified available.

Final workspace typecheck and lint passed. Back Office `next build` passed with all 35 static pages generated, including `/wholesale/returns`. Build used only synthetic loopback API/Auth configuration; no hosted sign-in or financial command was executed. These results cover the current source changes, not an immutable committed/CI-verified release artifact.

## Remaining Gates

### Follow-up HTTP Coverage

Added 38 HTTP regression cases (54 total in `wholesale-returns.test.ts`) for explicit credit application/refund success, exact input/key and stable actor-bound hash, zero/negative/fractional/unsafe amounts, client tenant/customer overrides, missing authentication/key, foreign selection/non-membership, multiple-membership selection, sanitized database denials and unconfirmed/invalid-reference payouts. Leading-zero external references survive successful responses. Route handlers use mocked repositories: these cases do not prove database idempotency, ledger effects or actual bank settlement.

An initial test incorrectly expected the missing tenant header to fail for a sole membership. Inspection confirmed the existing server resolver intentionally selects the only authenticated membership. Corrected the test assumption, added explicit single/multiple/foreign tenant cases, and did not change runtime policy. Initial mock union typecheck failure was fixed with typed contract-parsed adapters.

Final follow-up verification: 824 application tests across 42 files and 47 simulated harness tests passed; API typecheck, changed-file lint/format and diff whitespace checks passed. Only the API test file changed in this follow-up; no runtime/schema/build/deployment was performed. Earlier 23 disposable-database tests and Back Office build remain historical checkpoints, not repeated here.

Actual pgTAP execution; multi-session locking races; remaining API/application/refund negative coverage; authenticated populated UI and reload/response-loss tests; immutable note detail/print workflow; final independent review; exact-commit CI; release approval and coordinated migration/API/Back Office rollout. Other application/Cloudflare builds are not verified in this increment.

The current whole-unit, positive-price, zero-tax/discount return restriction is intentional. Same-customer/same-branch credit application and funded-payout blocking remain enforced. GCash/bank payout records external action; it does not transfer money.

AW3's blocked exact fifteen-migration Staging release remains a mandatory separate return gate. No alternate launch, credential use, shared migration, access grant, financial transaction, deployment or Production change was attempted here. AW4 migration is not part of the earlier fifteen-migration approval.
