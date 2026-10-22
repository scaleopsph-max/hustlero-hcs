# AW4 Fund Reversal And Return Valuation

## Scope And Release Boundary

Owner approved both local extensions and explicitly deferred Online Store. Work
stays on AW4 draft PR #5. No hosted migration, financial UAT, credential, paid
resource or application release is included. AW3's unresolved execution rejection
and frozen fifteen-migration manifest are unchanged.

Three new ordered extension scripts follow the unshipped AW4 foundation:

- 20261021031833: full original-split fund reversal and refund eligibility.
- 20261021032431: fractional/original discounted/taxed valuation and note evidence.
- 20261022001734: consistent item/category payable reporting and channel scope.

The resulting local candidate contains 84 migration scripts. These are not an
authorized expansion of any previous hosted migration batch.

## Financial Rules Verified Locally

Fund reversal preserves the original allocation and collection. It requires
explicit funds.reverse authorization (or active owner), current entitlement and
all branches represented by the receipt. The full original split is derived
server-side; affected accounts are locked in deterministic order and checked
independently. Negative append-only entries reference exactly the validated
original entries. A reversed receipt never becomes eligible for fresh allocation.
Reversal pays no cash and creates no credit, receipt, stock movement or new debt.
Payout remains a separate command with existing credit/method/register controls.

Original header discount and tax are allocated proportionally against gross line
totals in UUID order using cumulative half-up cent rounding. Return money uses
the difference between cumulative rounded original payable amounts. Derived
original gross/discount/tax/payable/quantity evidence is stored on immutable note
lines. Current catalog prices and tax rates are never used. Non-restock, debt,
customer-credit, idempotency and common event timestamps retain the AW4 rules.

Examples executed in disposable PostgreSQL 17:

- Gross 3.03, discount 0.10, tax 0.35, payable 3.28. Returns of 0.333, 0.667, 1 and
  1 units credit 0.36, 0.73, 1.10 and 1.09 exactly; original invoice is unchanged.
- Gross lines 1.01 and 2.02, header discount 0.02 and tax 0.05. Original payables
  allocate to 1.02 and 2.04. Full returns reconcile item reporting to zero.
- A free line does not suppress paid-line reporting allocation. Free/zero-payable
  return lines and zero-cent slices remain explicitly rejected without effects.
- Unreconciled wholesale data yields a sanitized reconciliation conflict; it is
  never silently gross-valued. POS-only reports exclude that wholesale data before
  valuation, while all/wholesale reports fail closed.

## Review And Verification

Independent read-only review identified and corrected mismatched validated/debited
ledger sets, permanently trapped definitive rejections, wholesale gross fallback,
an incorrect suspension-test SQLSTATE, and all-channel preflight affecting POS.
The final bounded channel review found no actionable issue by inspection. Review
is not hosted acceptance or independent execution of the regression suite.

Executed local disposable suite: 32 reported cases passed after the channel fix,
loading all 84 scripts. Coverage includes paid/partial/unpaid returns, exact replay,
tenant/branch denials, stock, statements, COGS, funds, malformed inactive source
legs, reversal liquidity, allocation retention, separate payout, immutable derived
evidence, zero-cent denial and mixed-channel reporting.

Application/DOM tests include authenticated scope forwarding, sanitized conflicts,
fractional preview inputs, preserved original allocation display, exact pending
key/body reload, unknown-response retention and explicit definitive-rejection
dismissal. Final full local check passed: 882 application cases across 45 files,
47 simulated harness cases, format/lint/typecheck, complete Next.js builds and
Cloudflare dry-run builds. Dependency gate found no unaccepted high/critical
advisory; existing build-time exceptions are unchanged.

Exact-source CI is pending at this document checkpoint. New pgTAP files and
independent-session reversal cases are added to
the existing disposable CI workflow; they are not claimed executed here. Hosted
Staging/Production migration, authenticated acceptance, source incorporation and
separately scoped release remain pending.
