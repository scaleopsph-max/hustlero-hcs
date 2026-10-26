# AW3 And AW4 Combined Source Closeout

Date: October 26, 2026, Asia/Manila.
Owner clarified scope: all remaining AW3/AW4 development and QA; Online Store last.
Branch: codex/aw3-aw4-source-closeout. Source integration only, not main merge.

## Provenance And Module Coverage

Base is independently source-verified AW4 PR #7 head
d256339d5398065a81f0ccb87c18e1d14f745d4d. Integrated the frontend/shared-UI delta
of AW3 PR #8 from 10181e8 to ecb851fc2f1d78ee461199feef768379f97a83e9, plus its
two missing allocation-boundary contract tests. Original PR branches and frozen
2be9c76 release checkout/helper were not changed or merged remotely.

| Locked scope | Combined source state | Hosted acceptance |
| --- | --- | --- |
| AW3 credit/terms/opening receivables | Existing server rules retained; recovery fixes integrated | Pending |
| AW3 payments and funds | Exact receipt/split reconciliation, original-key recovery and report/display fixes integrated | Pending |
| Category pricing/reference capture/reports | Existing integrated rules plus report channel/centavo safeguards retained | Pending |
| AW4 returns and immutable credit notes | Original snapshot valuation, approved tax/discount allocation and fractional milli-units retained | Pending |
| AW4 customer-credit application/statements | Existing explicit application/liability/debt reporting retained | Pending |
| AW4 separate refund settlement | Existing authorized cash/external payout, four digits and funded-payout block retained | Pending |
| AW4 audited fund reversal | Original whole split, balance guards and separate payout retained; UI recovery race corrected | Pending |
| Integrated QA/release | Local app/DOM/browser evidence below; exact CI/review and hosted release remain distinct gates | Pending |

No new financial business rule, price, customer term, grant, real fixture or payout
was invented to fill this matrix. Source feature presence is not proof of hosted
readiness. Online Store and other deferred roadmap features are outside this scope.

## Integration And Corrected Defects

Preserved both AW4 reversal imports and AW3 refresh control when resolving the
funds workspace import conflict. Fund fixtures now include actual AW4 canReverse
and reversal fields instead of weakening parser/assertion checks. Explicit tests
cover historical allocation replay after a separate reversal and the existing
reversed-receipt denial. Original allocation history is not deleted or reposted.

Corrupt saved reversal previously locked the handler but left controls enabled.
Four red DOM cases reproduced it; readiness gating now disables the form/action
until restoration succeeds. Corrupt storage remains untouched; no replacement key.

Independent read-only review found P2 recovery loss: parent refresh could unmount
an unresolved reversal, then an older completion could delete a newer saved key.
Three red tests reproduced late completion, stale dismissal and missing parent
lock. Parent lock now covers Auth, POST and history read, with child disable state.
Full key/body matching guards storage before submission/replacement and before
completion/dismissal. Tests preserve newer commands across old unmounted responses
and block stale existing/fresh submission. No server concurrency rule changed.

Reviewer re-reviewed production changes and reported no remaining actionable
finding in this bounded interaction. It was read-only source/test review, not
test execution or release approval. Its noted deferred-Auth/history test gap was
then covered by two additional test-only scenarios; final focused DOM run passed
21 cases. Parent locks are tested during Auth, POST and history waits.

## Verification Checkpoints

Initial combined funds tests exposed three expected fixture-default mismatches;
corrected with real schema fields. Initial full check found formatting differences
from integration and one unsupported testing-library exact option; corrected
without weakening formatter/compiler settings. Final full local check passed
980 app tests / 48 files and 47 simulated harness cases, formatting, lint,
typechecks, standard builds and Cloudflare builds (exit 0). Exact source CI
remains pending at this source-document checkpoint.

New parent funds DOM suite covers allocation then separate reversal, immutable
history/net-zero funds, replay after lost response and refresh/remount, allocation
refresh loss with AW4 controls, independent permissions and all three await phases.
Standalone reversal tests cover corrupt storage, late old completion/new command,
stale dismissal and stale submission; helper tests check original key/full body.

Playwright/Edge actual combined read-only returns UI passed immutable note details,
restock/non-restock labels, disabled write controls, desktop 1440/mobile 390 layouts,
screenshots/overflow and zero external requests/page errors. Actual combined funds/
reversal UI passed corrupt-recovery preservation and disabled controls on both
viewports. Auth/API were mocked; no real hosted sign-in or ledger proof is claimed.
New harness/screenshots are ignored under tmp/aw3-aw4-integration-visual; historical
visual evidence was preserved, not overwritten.

## Release Boundary

All 84 migration scripts are unchanged from the AW4 base, tree
147455b3ad66b5283458c96072135fd257c212a7. No API, domain financial source,
contract definitions, lockfile, workflow, SQL or authorization changes. Contract
changes here are tests only. No live credential/access, mutation, migration,
deployment, paid resource, financial UAT or execution-policy bypass.

Existing AW3-only approval does not authorize this combined source or nineteen-
script hosted release. Current manifests reference older SHAs and must not be
silently reused; original source-bound helper must not be retargeted. Supported
execution resolution, explicit source-review/integration/release-path decision,
fresh body/backup/business/app preflight, separately bounded authenticated hosted
QA/reconciliation and Production approval remain required. No claim that all
AW3/AW4 release work is complete until those gates are satisfied.
