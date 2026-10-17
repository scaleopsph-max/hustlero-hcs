# Baseline Review Fixes: CSV And Logout Scope

Status: isolated candidate passed full local checks; exact-source CI and reviewed integration pending. No merge or live release.

## Scope

Branch `codex/baseline-review-fixes`, based on frozen AW3 `4413dd62d1922cfe900abccf44d239b7b3d1ee53`. Addresses the two P2 findings in [PR #1 review batch 1](https://github.com/scaleopsph-max/hustlero-hcs/pull/1#issuecomment-6230506631). The frozen branch and separate payment-reference PR #2 are unchanged. This is a proposed correction, not a claim that the original PR #1 head is already fixed.

- General Reports download now calls a dedicated serializer backed by the already installed Papa Parse library. Its formula-escape expression covers ASCII formula prefixes after Unicode whitespace/control characters, plus initial tab/CR/LF. Escaped text gets a deliberate apostrophe prefix. Numeric cells, including negative financial amounts, remain numeric. Quotes, delimiters and CR/LF use the CSV library rather than manual string concatenation. Stored product/method labels are unchanged.
- Ordinary Admin and Back Office logout now explicitly use `scope: 'local'`. The existing local recovery cleanup is retained. No global sign-out-everywhere action is added, and no MFA/allowlist/authorization behavior changes.
- No schema, API, POS, entitlement, dependency manifest/lockfile or financial-command changes.

## Regression Evidence

Eighteen focused tests cover formula-like labels, whitespace/control prefixes, delimiter/quote/CR/LF round trips, signed numeric cells, the actual Reports download boundary, and all three Admin/setup logout call sites. Logout tests parse the actual call-site options and exercise the installed Supabase SDK through a fully mocked fetch transport. No real credentials, sessions, browser storage or network Auth requests are used. These tests do not prove a live two-browser logout scenario.

Corrected red run: 16 failed/two passed with the old CSV serializer and ordinary global logout; failures assert real unsafe data/scope behavior. Green run with the candidate correction: all 18 passed. An earlier CSV test fixture used delimiter auto-detection for single-column data, producing warnings; the fixture now explicitly parses comma-delimited CSV. The corrected red and green runs, not the warning-only intermediate run, are the regression evidence. Local ignored logs: `review-fix-red-confirmed.log` and `review-fix-green-confirmed.log`.

The fresh Windows checkout used CRLF; formatting normalized line endings and index renormalization left only the intended tracked source changes. No user changes from the original evidence tree were reverted or staged.

## Verification And Release Gates

Full local `npm run check` passed with exit 0: format/lint, all workspace typechecks, 626 application tests/28 files, 47 harness cases, standard builds and Cloudflare-compatible builds. Dependency gate passed with the existing two documented build-tool advisory exceptions, not zero vulnerabilities. No dependency manifests or lockfile changed. Exact-source CI and reviewed integration remain pending. No local SQL execution, shared database change, application deployment, access grant, token or live logout was performed. Local ignored logs include `review-fix-check.log` and `review-fix-dependencies.log`.

Review this isolated fix against the frozen AW3 base before any approved integration. Incorporating it into PR #1 would change that release candidate and requires fresh exact-source/merge-context CI and coordinated Staging evidence; do not silently reuse the old 4413dd6 UAT as proof for a changed application. Review the remaining historical baseline before main merge. Production promotion stays separately approved.

Reference: [Supabase JavaScript signOut scope documentation](https://supabase.com/docs/reference/javascript/auth-signout). The installed SDK behavior was independently exercised by the tests; local logout is not permission or MFA bypass.
