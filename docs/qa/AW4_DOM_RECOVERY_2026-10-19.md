# AW4 Component Recovery Candidate

## Scope and Correction

Added isolated DOM tests of the real `WholesaleReturnsWorkspace` React component. Auth SDK and HTTP responses are synthetic; all fetches are intercepted and an unexpected origin is rejected. No real sign-in, browser Auth storage injection, provider transfer, financial posting or hosted SQL occurs. Component remount simulates reload with sessionStorage retained; this is not a real-browser or authenticated Staging response-loss proof.

Found a recoverability gap: unavailable payout method/session used HCWR2, also used by scope denials before idempotent replay lookup. The UI correctly refused to dismiss ambiguous scope failures but consequently trapped definitively rejected closed-session requests. The unreleased AW4 migration now emits HCWR6 for method/session availability rejection only after replay lookup; API maps it to a sanitized 409 and UI permits explicit dismissal. Earlier scope/authorization denials, unknown responses and missing independent command history still preserve the exact key/body. No automatic replacement key or blanket HCWR2 dismissal was added.

Existing close-first concurrency expectation changed to HCWR6. Added pgTAP unavailable-method/no-payout regression. This edits the unshipped AW4 candidate migration only; it is not applied to any hosted environment and does not alter the approved fifteen AW3 scripts.

## Local Verification

- Eleven component DOM tests passed: current preview invalidation; lost return/application/refund response with persisted original-key remount/retry; history mismatch retention; leading-zero external payout reference; actor change; corrupt storage; funded-payout option filtering; explicit proven-rejection dismissal; and scope-denial retention.
- Dismissal regression was executed failing before the UI correction, then passing after it.
- Full application suite passed 838 tests across 43 files, followed by 47 simulated harness tests.
- Back Office typecheck passed. An initial fixture union-narrowing error was fixed with the actual contract schemas; no production type guard was weakened.
- Pinned dev-only testing dependencies: Testing Library React 16.3.3, DOM 10.4.2, jsdom 30.1.3. Local Node 24.18.0 satisfies their engines and the repository Node-24 CI baseline. DOM project configuration isolates the Back Office alias and does not move existing unit tests into a simulated browser environment.
- Existing dependency-advisory policy passed without a new high/critical exception. No automatic audit fix or package install-script approval was performed.

Full local `npm run check` passed, including lint/format/workspace typechecks, 838 application/47 harness tests, standard and Cloudflare-target builds. Post-stage secret scan passed 567 tracked files. Generated Back Office JS/JSON output scans found no checked synthetic-test credential/fixture strings or DOM test-library references. Exact-head CI is pending at submission; this is not yet a release pass.

Actual populated browser layout, real Auth/API integration, hosted recovery and independent review remain pending. AW3 host execution gate is unchanged. No main merge, token, hosted migration/deployment, new paid resource, user access or Production change.
