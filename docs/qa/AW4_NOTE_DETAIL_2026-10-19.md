# AW4 Immutable Credit-Note Detail Candidate

Status at submission: focused contracts/component/recovery tests and synthetic real-browser checks passed; full final local check and exact-head PostgreSQL CI results tracked separately. No hosted release is claimed.

## Read-Only Vertical Slice

- Extend the existing authenticated, tenant/branch-scoped returns projection with immutable reason, commercial reversal identity, debt reduction and original returned line snapshots (name, whole-unit quantity, exact credit and stock disposition).
- Read names from original invoice lines, not current catalog records. Existing private tables, RLS, function grants and authorization checks are unchanged. No new command, permission, payment, payout or ledger side effect.
- Expand a note inline from compact responsive rows. Return, issued and available credit remain visible on mobile without scrolling across a wide history table. Raw ISO timestamp preserves its offset; this change does not invent a tenant timezone.
- Required runtime contracts reject inconsistent line totals, duplicate original lines, unsupported quantities or a mismatched debt/customer-credit split using exact integer arithmetic. This requires a coordinated AW4 API/Back Office release; older projections without the detail fields fail closed.
- Strengthen original-key response reconciliation to compare the immutable reversal ID, debt reduction and issued credit against authorized note history. Three unit regressions failed before the guard correction and passed afterward; a component regression preserves pending storage on a valid-but-different recorded split. Current available credit and current invoice debt are not compared to historical command results because later legitimate commands may change them.

## Verification

- Focused contract/component/recovery checks passed. Component tests cover read-only expansion without POSTs, escaped markup/non-restock display, invalid-line-total denial and retained pending command on settlement mismatch, alongside existing response-loss/remount paths.
- Existing disposable PGlite/PostgreSQL 17 candidate suite passed 23 reported tests after the projection change. This is not concurrent PostgreSQL or hosted proof.
- New pgTAP cases verify reason, exact reversal identity, quantity, amount, disposition, original snapshot stability after catalog rename/repricing, hidden other-branch detail, foreign-tenant denial and assigned read-only access without posting authority. Exact-head CI must execute these.
- Actual headless Chrome/Playwright at 1440x1000 and 390x844 passed expansion, read-only disabled posting, zero page errors, zero external requests and no document-level horizontal overflow. Both full-page screenshots were visually inspected; an initial wide-table mobile issue was corrected and rechecked.
- Browser harness is an untracked, fixed-loopback synthetic fixture using the actual component/CSS with mocked Auth/API. It writes no Auth storage, sends no real token, makes no hosted request and posts no financial command. Fixtures and screenshots stay outside application bundles. It is not authenticated hosted UAT or a real-session recovery proof.

## Release Boundary

The modified migration is the still-unreleased AW4 file 20261018123241; no applied migration history is rewritten. It is excluded from the approved fifteen AW3 migrations. Draft PR #5 remains separate from main. Supported AW3 execution resolution, reviewed integration, hosted Staging acceptance/reconciliation and separately authorized Production rollout remain required.
