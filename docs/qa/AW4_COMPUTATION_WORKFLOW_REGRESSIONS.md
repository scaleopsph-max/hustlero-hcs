# AW4 Computation Workflow Regression Follow-Up

Base: reviewed main 3df2c9f1644a4893726443fbded36f0d07ed60e3.
Scope: local computation/contract regression coverage and narrow dependency fixes.
No hosted database, credentials, security-policy edits or deployment.

## Added Coverage

Six deterministic domain tests cover 72 original discounted/taxed fractional
histories, 150 sequential credit/payment boundary sequences, collections between
returns, original-snapshot immutability and incremental credit, safe-integer money
limits/stale history, and line-order/restock-independent valuation. A separate
BigInt quotient/remainder oracle checks cumulative half-up cents without reusing
the implementation's rounding formula. Sequence counts are loop scenarios, not
additional Vitest test counts or hosted transactions.

Zero-cent selections, including a zero-cent tail after earlier rounded credits,
remain denied under the existing owner policy. Tests do not silently restock
those units, round them up or change the workflow's supported cases. Preview
settlement is not proof of actual application/payout/stock ledger behavior.

Two contract tests verify that an oversized 201-line request is rejected before
reading invalid element properties, and that 200 unique valid lines still pass.
This protects the existing collection limit with patched validation behavior.

## Security Dependency Gate

Fresh audit blocked Zod 4.6.5 and Undici 7.29.1 / Miniflare dependency chain.
Zod is pinned to 4.6.7 in API/contracts; a Miniflare-only override pins Undici
7.30.1. No business schema/domain production code, migration, authorization rule
or audit-policy exception changed. Do not describe the dependency fix as runtime
code equivalence: API validation library behavior changed and requires full QA.

Explicit Undici lock resolution also refreshes jsdom's already-patched 8.12.2 to
8.12.3 and deduplicates Miniflare's nested Sharp/platform packages to the existing
root patched Sharp override. No broad audit-fix/force or library downgrade used.
Clean installation, actual resolved-version checks, full app/build/dependency
checks and exact CI are required before acceptance.

Primary sources:
- https://github.com/colinhacks/zod/commit/a0ebf97
- https://github.com/colinhacks/zod/releases/tag/v4.6.7
- https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c

## Verification Checkpoint

Initial focused six domain tests passed. Initial full check correctly caught four
strict-index TypeScript errors in the new test; fixed optional result access and
literal tuple typing, without weakening compiler settings. Focused two-file run
then passed 35 tests. Patched lockfile dependency gate passed, with no new exception.
Clean npm ci completed. Direct module resolution verified Zod 4.6.7, Miniflare's
Undici 7.30.1 / Sharp 0.35.5 and jsdom's Undici 8.12.3. Fresh full local check
passed 890 app tests / 46 files, 47 simulated harness cases, format/lint/typecheck,
standard and Cloudflare dry-run builds, plus 585-file secret scan. Dependency
policy passed without new exceptions; remaining raw moderate advisories are not
represented as zero vulnerabilities. Exact CI pending at this committed checkpoint.

## Hosted Boundary

AW3's recorded execution restriction remains unresolved. No denied diagnostic/helper
retry or alternate write transport. Frozen fifteen-script runner unchanged. This
branch is not merged, not a release manifest refresh or live migration approval.
Existing hosted acceptance checklist remains Pending. Online Store stays last.
