# AW3-Only Security Release Candidate

Status: full local verification passed; exact CI pending; not a release approval.
Owner priority: finish AW3 before further AW4/Online Store work.

## Source Boundary

Base is last reviewed AW3-only main e2437adf40f6bddcde8c9a12eeec680b504eedba,
not current main 3df2c9f (which already includes AW4). Reused clean managed
payment-reference-reconciliation checkout on new codex/aw3-only-security-candidate.
Preserved separate AW4/PR #7 checkout, owner workspace changes, and frozen AW3
2be9c76 checkout/helper. No user work or branch history reset/rewrite.

Only four app Next.js pins to 16.4.2, API/contracts Zod pins to 4.6.7, Miniflare
Undici override 7.30.1, generated lockfile, AW3 contract tests and source notes.
These patches are already independently implemented/verified in later source
work; this candidate still needs its own actual installation/build/CI evidence.
No advisory exception expansion or broad audit-fix/force/downgrade.

No financial production-source, SQL migration or permission change. All eighty
AW3 migration scripts remain byte-identical to historical 2be9c76:
migration tree 077f15abb7614005c44d52107705d31cb4fb30ec. AW4 foundation/extensions,
return/credit/payout API/UI and reversal workflows are not part of this candidate.

Two AW3 allocation contract regressions test early rejection of 501 invalid
invoice entries without reading their fields, exact 500 unique valid invoice
allocations totaling 500 minor units, and rejection of a one-cent receipt mismatch.
The existing limit is unchanged; these are local parser tests, not live receipts.

## Local Verification

Clean npm ci and direct module resolution verified Next.js 16.4.2, Zod 4.6.7,
Miniflare Undici 7.30.1 and Sharp 0.35.5. Focused AW3 contracts passed 13 tests.
Full local check passed 713 application tests / 38 files, 47 simulated harness
cases, formatting/lint/typecheck, standard and Cloudflare dry-run builds and
550-file secret scan. Dependency policy passed with no new exceptions; raw
moderate advisories remain. Reviewed lockfile changes cover patched Next/env/SWC,
Zod/Undici and deduplication to the already-approved root Sharp override.
Exact head database/reset/concurrency CI remains pending at this checkpoint.

Primary patch references:
- https://github.com/vercel/next.js/releases/tag/v16.4.2
- https://github.com/colinhacks/zod/commit/a0ebf97
- https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c

## Release Gates

This candidate is not main integration, a source-policy exception or automatic
release authority. Owner previously selected reviewed PR/main; do not silently
substitute this historical-base candidate for that path. Once exact candidate
passes source review/CI, obtain the source-path decision before any hosted use.
Combined-current-main release would include AW4 and require its separate scope;
an AW3-only release must explicitly approve its exact candidate/app artifacts.

Historical execution denial remains unresolved. No helper/diagnostic launch retry,
alternative write transport, rule edit, credential, hosted migration, app upload,
financial UAT, access grant, paid project or Production action. Old fifteen-script
guard stays unchanged/bound to 2be9c76; matching SQL is not permission to retarget it.

Before hosted release: supported execution resolution, fresh exact migration
version/name/body parity and protected baseline/backup, exact migration/app scope,
diagnostics OFF, authenticated bounded acceptance/ledger reconciliation, then
separate Production approval. Do not declare AW3 fully released from source QA.
