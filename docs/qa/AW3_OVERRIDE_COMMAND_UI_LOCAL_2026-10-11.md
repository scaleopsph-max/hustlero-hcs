# AW3 Override Command UI Local Verification

Date: 2026-10-11

## Scope

- New `/wholesale/approvals/manage` screen and authorized history navigation.
- Existing override POST APIs only; no new migration or backend change.
- Explicit scoped action/order, exact excess, future expiry, reason, independent attestations.
- Immutable revocation, current-account authorization and user/tenant-scoped pending-command storage.

## Executed evidence

- Format/lint/typecheck and 440 Vitest cases across 20 files passed; 39 added UI command-rule cases.
- Synthetic Playwright desktop 1440x1100 and mobile 390x844 passed. All API/Auth traffic used synthetic interception; no live financial command.
- Invalid three-decimal money was rejected before POST; valid PHP 100.01 sent 10001 minor units.
- Approve and revoke each simulated commit followed by lost response. Reload and dedicated retry used the exact original key/body/path, leaving one approval and one revocation.
- Already-revoked approval remained retryable via stored command, without selecting a new target.
- Approval attestation did not satisfy revocation attestation.
- Definite rejection unlocked editing. Unit checks retain pending identity on permission/scope/unknown failures.
- Reader received no write controls; failed refresh cleared stale context and subsequent refresh recovered.
- Desktop/mobile screenshots inspected, no document horizontal overflow or page errors.
- Dependency audit passed with only existing accepted build-time advisory chains.
- Full local `npm run check` exited 0, including standard application builds, API Worker dry run and all Cloudflare builds. Existing vinext dynamic-import/static-classification notices were non-failing warnings.

## Remaining release gates

New increment not pushed or run through isolated CI. Existing pgTAP/concurrency suites were not rerun locally. Add execution-screen approval selection and durable action retry; complete payment/confirmation/opening/cancellation races; then full isolated CI, Staging deployment/UAT and separately authorized Production release.

No live approval, revocation, opening debt, receipt, stock, or fund movement occurred. Existing Production invoices remain untouched.
