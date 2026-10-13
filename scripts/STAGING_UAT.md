# Controlled Staging UAT Runners

These tools target the fixed HUSTLERO Staging API/Auth project only. They are not application deployment commands. No Production target, browser-session extraction, secret/service-role key or privileged SQL business write is supported.

Run unit regressions with `npm test`. Formatting and lint include `scripts/staging-*.mjs`; complete application/database CI remains mandatory before release. Unit mocks never constitute live UAT evidence.

## Private Local Execution

With the approved Staging publishable key in process environment only, set `HCS_STAGING_UAT_MODE` to exactly one of `isolation`, `fund-recovery`, `paid-replay`, `paid-rollback`, or `approval-consumption`, then run `node scripts/staging-isolation-server.mjs`.

The runner binds `127.0.0.1:3014`, validates Host/Origin/random nonce, returns no-store/restrictive-CSP headers, and accepts one private password form submission. Credentials stay in process memory and the created harness session is logged out locally after the batch. Clearing references is not a guarantee of cryptographic memory erasure. No new password is generated or saved. Sanitized result is available at `/result`; stop the runner after collecting it.

Exact live side effects/access must be owner-approved before execution. Owner-required modes also require a matching form attestation. Never reuse the restricted tester as an owner, widen its role automatically, transmit credentials to Production or retry a changed command using a new key after an unknown outcome.

## Modes And Limits

- `isolation`: exact temporary non-owner/single-branch/two-permission tester. Assigned report reads, explicit unauthorized Main Store/non-member sentinel tenant and rejected confirmation on a nonexistent order. Deactivate approved temporary access immediately after the batch; session logout alone does not revoke membership.
- `fund-recovery`: one fixed synthetic receipt split into Capital/Operating funds. Exact-key response replay and wrong-split/duplicate denials. The append-only allocation remains; no real settlement or bank transfer is inferred.
- `paid-replay`: fixed historical COD/Prepaid keys/bodies. Returns original invoices even after order cancellation. Changed-body/new-key and approval-creation scope/expiry denials; no fresh delivery planned.
- `paid-rollback`: one fixed fresh mixed-variant draft, temporary COD limit, confirmation, rejected unpaid/under/over/missing-method fulfillment, cancellation and original-term restoration. Unexpected concurrent settings are not overwritten. Cleanup preserves any unexpected business truth rather than deleting it.
- `approval-consumption`: fixed fresh mixed-variant draft pair, exact bounded exceptions, server-observed expiry and isolated order/action denials. Only supported confirmed/partial orders are cancelled; inert drafts remain unfulfilled/unreserved with all test approvals revoked. This cleanup interpretation needs owner acceptance. Per-case progress is retained on failure.

Fixed fixture/key modes deliberately fail preflight if already-used orders exist. Do not change fixture names or grant new access to obtain a passing rerun without a separately reviewed/approved plan. The original approval batch failed cleanup; corrected local tooling does not retroactively turn it into a live pass.

## Evidence Rules

Verify status and exact error codes, then independently reconcile business counts, balances, reservations, immutable records, audit/outbox uniqueness and rejected idempotency keys. Sanitized console output may retain names/status/error/trace IDs, never raw Auth responses or credentials. Keep private screenshots/CSV/dumps/logs out of the public repository.

Deliberate response discard and historical API replay are not real network-loss/browser-reload proofs. Sentinel tenant denial is not populated second-tenant isolation. Document those limits and unresolved outcomes before separate Production approval.
