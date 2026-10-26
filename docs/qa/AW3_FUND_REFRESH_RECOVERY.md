# AW3 Fund History Refresh Recovery

Date: October 26, 2026, Asia/Manila.
Source-only development follow-up to AW3 candidate 10181e8.
Branch: codex/aw3-fund-refresh-recovery. No hosted release is claimed.

## Defect And Correction

WholesaleFundsWorkspace cleared saved pending command/key/body and displayed a
success message before refreshing fund history. A failed GET then left no context
or refresh control, despite a possibly committed allocation. Response identity
was validated, but refreshed history was not independently matched before clearing.

Completion now requires the refreshed context to contain exactly one matching
receipt with the original total, payment identity, Capital/Operating split and
allocation event time. A malformed/missing/mismatched history or failed refresh
retains the original command for recovery. Equivalent timezone representations
of the same event are accepted. Account/tenant-scoped storage and server-side
idempotency remain unchanged. This check does not prove provider settlement.

A read-only refresh control recovers failed context loads, retains pending
commands, clears stale success and uses the existing original-account check.
No change to financial computation, server authorization, API contracts, SQL,
migrations, Auth configuration, hosted credentials or test-runner execution policy.

## Executed Evidence

- Focused payment/fund tests: 85 passed, including 13 new fund-history regressions.
- Full npm run check: 726 app tests / 38 files, 47 simulated harness cases,
  formatting/lint/typecheck, standard builds and Cloudflare dry-run builds passed.
- Tracked-file secret scan passed across 550 files before this new document.
- Local synthetic Playwright/Edge workflow mounted the actual funds component
  with mocked Auth/API only: failed post-success history refresh retained command
  without success, reload restored exact key/body, replay used the identical
  command twice but produced one mock allocation, and pending storage cleared only
  after matching history. Initial-load failure recovered by refresh; read-only
  control produced no POST. Desktop/mobile screenshots and overflow check passed;
  these are isolated component checks, not the full hosted shell or real auth QA.
- Harness and screenshots remain ignored in tmp/aw3-funds-browser; no credential
  or real financial data was used. Browser binary fallback used installed Edge;
  the initial default Playwright browser was not installed. The initial harness
  stylesheet configuration was corrected before the final layout check passed.

No fresh SQL test or hosted acceptance result is implied by local app checks.
The existing exact-candidate CI remains evidence only for 10181e8, not this patch.
Source review/CI and existing hosted execution/source-path/acceptance gates remain.

## Continuous Credit And Payment Follow-Up

The same premature pending-clear/success order existed in credit settings and
opening receivables. Both now validate the original POST response and complete
both context reads before clearing storage or reporting success. The UI does not
require current credit settings or an invoice's remaining balance to equal the
historical POST response: subsequent authorized revisions/payments are legitimate,
and the original-key replay must not overwrite or reject them.

Only null storage means no pending credit command; empty/corrupt values now fail
closed instead of silently preparing a replacement command. Manual credit and
payment refresh clear stale success before loading, including failed refreshes.
No change to original permissions, payment terms, opening computation or API/SQL.

Seventeen new credit regressions passed; focused payment/fund/credit suite is 146.
Full local check passed 743 app tests, 47 simulated harness cases and all builds.
Synthetic actual-component browser checks passed settings/opening POST-success
refresh loss (including failure of the second read), reload and exact-key/body
retry with one mock posting, corrupt empty storage fail-closed, stale-success
clearing for payments/credit and mobile screenshots/overflow. Original fund browser
batch was rerun and passed. Auth/API remain mocked. The first new browser harness
attempt reset its own synthetic state on reload; fixture initialization was fixed
and the final batch passed. Exact-head CI for this additional source commit must
complete separately; prior 726-test CI does not prove the new head.
