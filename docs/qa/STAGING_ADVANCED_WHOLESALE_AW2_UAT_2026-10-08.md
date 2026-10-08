# Staging Advanced Wholesale AW2 UAT - 2026-10-08

## Scope

Controlled validation of the approved AW2 partial-fulfillment, immutable-invoice, Sales archive, reporting-contract, and shared-inventory slice in the isolated `HUSTLERO HCS Staging` environment. Production was not changed.

## Release Record

- Supabase project: `HUSTLERO HCS Staging` (`sdfwdhbryjyfufgtfqmf`)
- Database migration: `20261008045840_advanced_wholesale_partial_fulfillment_invoices`
- API Worker version: `4b94f93c-fb64-48d2-ab5f-bb51e7b402c8`
- Back Office Worker version: `49e3b2d7-f7a1-4a43-8796-9b34f1f9c1c8`
- Tenant: `PABL0`
- Test order: `SO-20261008-002`
- Customer: `UAT Reseller 001`
- Location: `Main Store`
- Variant: `P-00001`
- Ordered quantity: 6
- Unit price snapshot: PHP 800.00
- Order total: PHP 4,800.00
- First invoice: `INV-20261008-000001`, 2 units, PHP 1,600.00
- Final invoice: `INV-20261008-000002`, 4 units, PHP 3,200.00

## Verification Results

| Check | Result |
| --- | --- |
| Migration ledger | Passed: the repository migration version and name are recorded exactly |
| API deployment | Passed: health 200, unauthenticated `/v1/me` 401, and exact Back Office-origin CORS 204 |
| Back Office deployment | Passed: `/wholesale` returned 200 and the authenticated owner session loaded AW2 controls |
| Draft | Passed: a six-unit draft was created with server-resolved snapshots and no inventory mutation |
| Confirm and reserve | Passed: status changed to `confirmed`; available stock changed from 9 to 3 while on-hand remained 9 |
| Partial fulfillment | Passed: two units created immutable invoice `INV-20261008-000001` for PHP 1,600.00 and status changed to `partially_fulfilled` |
| Final fulfillment | Passed: four remaining units created immutable invoice `INV-20261008-000002` for PHP 3,200.00 and status changed to `fulfilled` |
| Shared inventory | Passed: final on-hand is 3, reserved is 0, and the same branch-variant stock remains the retail and wholesale source of truth |
| Database reconciliation | Passed: ordered 6.000, fulfilled 6.000, cancelled 0.000; invoice quantities reconcile as 2.000 + 4.000 |
| Sales archive | Passed: the final wholesale invoice opened as a completed receipt with order, customer, location, SKU, quantity, price, and total snapshots |
| Refund/void boundary | Passed: wholesale refund and void controls are disabled and explicitly deferred to AW4 |
| CI regression suite | Passed before release in GitHub CI run `37731734969`, including 56 AW2 database assertions and all 93 Vitest cases |
| Secret scan | Passed after deployment across 352 tracked files |
| Temporary credentials | Passed on 2026-10-09: both scoped AW2 Staging deployment tokens were revoked and the account token list was verified empty |
| Production isolation | Passed: no Production migration, Worker, entitlement, order, invoice, or inventory record was changed |

## Corrected UAT Defect

After the cancelled AW1 order `SO-20261008-001`, a refreshed new-draft form initially proposed the same order number. The API correctly rejected the duplicate and preserved all records. Manually advancing to `SO-20261008-002` allowed UAT to continue. The Back Office follow-up now derives the next suggestion from the highest same-day order ordinal, including cancelled and fulfilled orders, while server uniqueness remains the authoritative guard. Regression coverage includes empty, gapped, cancelled/fulfilled, cross-day, and malformed-number inputs. The corrected Staging deployment loaded both prior orders and visibly proposed `SO-20261008-003`.

## Advisor Notes

Post-migration Security Advisor findings remain informational `rls_enabled_no_policy` notices for private application tables. This matches the established architecture: browser roles have no direct private-schema DML or function access, the restricted API role is server-only, and RLS remains defense in depth. Performance Advisor findings are informational supporting-index and newly-unused-index candidates, with no AW2 release blocker.

References:

- [RLS enabled without policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [Unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)

## Conclusion

AW2 Staging UAT passed. One confirmed wholesale order can consume its reservation through multiple atomic fulfillments, each fulfillment creates a separate immutable invoice, the Sales archive displays the resulting receipt snapshots, and final inventory reconciles with zero reservation. The order-number suggestion defect found during UAT is regression-covered, deployed, and visibly verified. Production Advanced Wholesale remains unchanged and requires a separate release approval.
