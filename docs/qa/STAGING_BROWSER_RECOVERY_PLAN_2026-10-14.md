# Staging Browser Recovery Plan

Status: owner explicitly approved the bounded historical-recovery build/batch on October 14. Local implementation/full checks passed; exact-commit CI and diagnostic release/replay pending. Approval is conditional on successful exact-commit CI. This plan does not close first-commit response-loss proof or authorize Production promotion.

## Local Candidate Verification

- Full npm run check exited zero: format/lint/all workspace types, 548 application tests (25 new diagnostic regressions), 47 controlled harness tests, standard Next/API dry-run and Cloudflare-compatible builds. Focused payment/fund/order/diagnostic suite passed 134 cases before the four additional per-family fixture tests were included in the full suite.
- Normal Next static bundles and normal vinext server/client JavaScript contain none of the historical fixture references or diagnostic UI label. Enabled diagnostic artifact exclusion is also guarded by build-time exact Staging endpoints/environment and a maximum 60-minute future expiry. Artifact-specific Staging opt-in build verification remains required before release.
- Build configuration and runtime tests cover origin/actor/tenant/window, original payload hashes, wrong context/body/key/route, existing empty/malformed pending slots, persistent one-shot response withholding, uncertain transport/result refusal, two-attempt/eight-total limits and guarded cleanup. Diagnostic errors preserve standard pending recovery for reconciliation; no automatic alternate key or repeat after an uncertain first request.
- Dependency gate passed under the existing accepted build-only advisory chains, not a zero-vulnerability claim. Staged secret scan passed 477 tracked files. No Auth credential read/log, live mutation or deployment in local verification.

## Verified Preflight

Read only from Staging project sdfwdhbryjyfufgtfqmf, PABL0 tenant b3a4f304-7d38-46fe-831e-db0370f9d0c3. Four original command records exist, completed with HTTP 201 and stored response bodies. Local SHA256 assertions match the actor-bound API payload hashes for all four; no HTTP POST executed.

| Case             | Original Key                                           | Immutable Outcome                                                                                                            |
| ---------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Payment          | wholesale-payment-abe311b9-6e33-423d-9335-cbd32067e17b | PHP 800 receipt 374ffa4a-1fa7-4220-ad2a-36b90c41c8f6; one PHP 800 allocation to invoice 91733d8e-b0a8-496f-835d-6ec32e8ee191 |
| Funds            | uat-fund-recovery-20261013-800-500-300                 | Same receipt, PHP 500 Capital and PHP 300 Operating                                                                          |
| COD delivery     | 8dc7f7a4-c51a-4b8f-bdee-1b3583a7da40                   | Historical PHP 1,600 invoice b6ca6bf8-3b48-4e27-b7d8-17aba275b385                                                            |
| Prepaid delivery | dac38357-f2ef-4e8e-b3d1-db742603df69                   | Historical PHP 1,600 invoice 81f8d91e-ccc6-4a99-85da-c2a5d038964e                                                            |

Original actor is the existing Staging owner d4bc81e3-3391-4106-88c7-b256661d8f71. Payment reconstruction uses the recorded cash method fc75965f-b614-4a78-a1c1-562a7aad21b5, customer 5a3fdf97-3259-42e4-a340-86f045998b35, reference AW3-UAT-PARTIAL-20261012 and exact invoice allocation. Fund and paid bodies use the existing frozen fundPlan/paidPlans definitions. Payment hash b9afed9686e389cdb067b9c05cbc0601e612eb60cbf84bfdc4cc3f3bc6925ec6 and fund hash 14442a1986e36e9f3eb90980821a7e180f32ec6fea2dd4e5b1768c44f980d2ff matched independently. Both paid hashes matched verifyHistoricalHash and the stored records.

Recorded expiry timestamps must not be extended or deleted. Completed-response replay is distinct from uncompleted-key expiry; the fund SQL returns the completed original response after hash and current authorization checks. Recheck deployed semantics and record presence immediately before each case. Both historical paid orders are now cancelled; any new delivery is outside this plan.

## Supported Mechanism Proposal

Current CUA browser surface supports navigation, visible form controls and read-only DOM inspection, not network interception, offline mode, storage mutation or initialization scripts. Do not use another browser backend, raw Auth/session extraction, global fetch replacement or service-worker interception to bypass that limitation. The previously rejected local mock app launcher remains stopped; this is not permission to relaunch it.

Proposed alternative is an explicitly owner-approved, temporary diagnostic build of the owned Staging Back Office application, operated through visible UI controls. Before release, build and review the implementation against these constraints:

1. Compile-time opt-in plus exact Staging UI/API/Auth origins; no diagnostic implementation or fixture manifests in a normal/Production bundle. Fail closed for absent flag, wrong host, expired diagnostic window or different authenticated owner/selected tenant. No authorization bypass, access grant, migration or API deployment.
2. Explicitly labeled historical recovery controls only. Restore a fixed original pending record into its normal user/tenant-bound application command slot only after an operator click. Never inspect, export or modify Auth storage. Refuse to overwrite any existing pending record; no arbitrary JSON, key, URL, amount or payload input.
3. Fixed allowlist of the four exact key/body/route cases above. Independently verify stored completed key/hash/response and immutable effects before enabling each case. No new key generation, fresh payment, settlement claim, fund allocation, delivery or credit approval.
4. Withhold exactly one successful matching historical replay result inside the owned command transport, after the live API has returned success and before the workspace processes it. Do not intercept unrelated requests or modify server results. Record sanitized key/body hashes and fault-consumption state, never bearer credentials. Persist the one-shot marker across normal reload so the original retry is not repeatedly faulted.
5. Reload the existing production-shaped workspace, verify the restored pending state, then use its ordinary original-command retry. At most two POST attempts per case, eight total; stop on unexpected status/identity/authorization, absent history or changed baseline. Fresh commands and alternate keys remain outside the batch.
6. Same-origin diagnostic window no longer than 60 minutes. Local regression tests must cover wrong origin/actor/tenant/hash, expired window, occupied pending slot, one-shot persistence, request budget and Production exclusion. Full checks and exact-commit CI required before the separately authorized Staging-only release; record exact SHA/version.
7. Independently reconcile receipt/invoice/stock/debt/fund/audit/outbox/idempotency effects after each case and final cleanup. Restore clean verified Back Office baseline a7ea4fe (currently version 4e0c190e-de59-4df9-a963-12cd0bcce887), verify live clean assets/version and preserve original business history. Remove only explicitly created diagnostic markers; never clear unrelated or unresolved pending commands. B stays suspended and tester stays deactivated.

The diagnostic build/release, reconstruction of application pending records, and bounded replay POSTs require an explicit owner scope approval. The existing exact-SHA exception for a7ea4fe/read-only smoke is not approval for a different diagnostic candidate. This document grants no such approval.

## Evidence Limits

Passing this batch would prove reconstructed historical pending recovery in the deployed workspaces, original key/body retry, response identity validation and no duplicate immutable effects. It would not prove that a newly committed command naturally persisted its pending state before its first response was lost. That first-commit browser subgate needs a separately reviewed fresh synthetic transaction scope or an explicitly documented release decision; it must not silently be marked passed by historical replay.

No successful business command, diagnostic code, pending storage write, fault registration, access change, CLI token or deployment was performed in this preflight. Normal reload evidence and the existing local/CI tests remain separately labeled in AW3_BROWSER_RECOVERY_HARDENING_2026-10-14.md.
