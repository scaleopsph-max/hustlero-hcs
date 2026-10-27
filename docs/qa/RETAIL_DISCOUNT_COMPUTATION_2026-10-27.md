# Retail Discount Computation Checkpoint

Source-only October 27. Owner approved one predefined whole-retail-ticket
discount, fixed or percent, dedicated manage/apply permissions and positive
payable only. Reject 100%, fixed amounts at/above subtotal, zero-cent rounded
discounts, mixed wholesale/dealer, nonzero tax, loyalty redemption and stacking.

Implemented strict configuration contracts (including optimistic edit/archive
revisions) and pure quote computation. No endpoint, permission grant, persistent
definition, sale posting or live migration is implemented by this checkpoint.

Focused verification executed:

- 66 tests passed across domain/contracts.
- Domain/contracts TypeScript checks passed.
- Integer/BigInt half-up rounding, stable ID order, exact allocation sums and
  nonnegative bounds verified exhaustively across 12,501 valid three-line small
  cent allocations, plus maximum-money and 200-line cases.
- Definition snapshot and input-order invariance, no input mutation, invalid
  money/rates, missing revisions, foreign caller context and offset timestamps.

Initial typecheck caught an array-table test fixture being spread as arguments;
corrected to named case objects and specific error matching, then reran both
focused tests and typechecks successfully. No runtime test failure was ignored.

Full local `npm run check` completed successfully: formatting, lint, workspace
typechecks, 1,243 app tests / 64 files, 47 simulated harness cases, standard builds
and all Cloudflare builds. Secret scan passed across 639 tracked files after
staging the exact new source/docs. A subsequent response-history validation
tightening passed all 24 contract tests, contract typecheck and targeted lint;
it adds no database/API/UI binding. Existing vinext bundling/classification
warnings remain warnings, not evidence of route acceptance. No new hosted or
isolated database test execution was needed or performed for this pure foundation.

Database/API/UI/POS
integration, snapshot-based refunds and reporting remain pending; the 66 focused
tests do not prove those workflows or hosted readiness.
