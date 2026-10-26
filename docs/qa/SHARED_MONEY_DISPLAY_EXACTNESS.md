# Shared Money Display Exactness

Date: October 26, 2026, Asia/Manila.
Source-only follow-up to the report boundary finding on draft PR #8.

## Correction And Compatibility

formatPeso now splits safe-integer minor units using BigInt quotient/remainder.
Intl currency formatToParts supplies the existing PHP symbol, grouping and layout;
the exact two-digit remainder replaces its fraction part. No safe-integer centavos
are divided through floating-point currency formatting. Positive and negative
9007199254740991 minor units retain .91, not the previous .90 display.

formatPesoSigned retains plus signs for positive amounts, the existing true minus
sign for negatives and no sign for zero/negative zero. The number-based function
signature and Centavos alias remain unchanged. Existing non-safe-integer/fractional
preview inputs keep their legacy formatting fallback; this does not expand valid
financial command input. Upstream server/contracts still own money validation.

Call-site inspection found fractional POS preview expressions before server quotes,
so no new exception or rounding rule is introduced for those existing callers.
parsePeso and other parsers, stored values, financial computations, contracts,
SQL/API, permissions and ledger posting are unchanged. This is presentation only.

## Verification

- Thirty-three new shared UI tests cover literal centavo boundaries, negatives,
  grouping, signed/zero behavior and legacy preview/non-finite compatibility.
- A single property-style case checks 2,000 signed safe-boundary values. Another
  checks 500 ordinary amount/remainder combinations against previous formatting.
  These are assertions inside tests, not thousands of additional test cases.
- Focused shared-money/report/payment suite: 95 tests passed.
- Full local npm run check: 782 app tests / 39 files, 47 simulated harness cases,
  format/lint/typecheck and all standard/Cloudflare dry-run builds passed.
- Synthetic actual shared helper and funds component Playwright/Edge check passed
  exact large positive/negative balances, ordinary/signed/negative-zero outputs,
  read-only no POST, desktop/mobile screenshots and overflow checks.
- Prior funds, credit/opening/payment and report/CSV synthetic browser batches
  reran and passed. Auth/API mocked; no real auth or hosted financial acceptance.

The previously documented shared formatPeso safe-integer display gap is fixed in
this source increment, not on hosted deployments. New exact-head CI/review remains
pending at this committed checkpoint. No source merge, live deployment, migration,
credential, bank operation, financial test transaction or policy bypass occurred.
