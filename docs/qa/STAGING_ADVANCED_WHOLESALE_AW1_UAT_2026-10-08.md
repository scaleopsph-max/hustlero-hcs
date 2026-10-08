# Staging Advanced Wholesale AW1 UAT - 2026-10-08

## Scope

Controlled validation of the approved AW1 sales-order and shared-inventory reservation slice in the isolated `HUSTLERO HCS Staging` environment. Production was not changed.

## Release Record

- Supabase project: `HUSTLERO HCS Staging` (`sdfwdhbryjyfufgtfqmf`)
- Database migrations: `20261005233310_advanced_wholesale_sales_orders`, `20261007043637_advanced_wholesale_tenant_toggle`
- API Worker version: `983b06b6-fe0d-43ae-ba7c-0d8179823848`
- Back Office Worker version: `64d5c1c6-6715-4bb2-aed5-52e5650a4fc6`
- Tenant: `PABL0`
- Temporary add-on expiry: 2026-10-14 23:59:59 Asia/Manila
- Test order: `SO-20261008-001`
- Customer: `UAT Reseller 001`
- Location: `Main Store`
- Variant: `P-00001`
- Quantity: 6
- Price list: `Wholesale price list`
- Unit price snapshot: PHP 800.00
- Order total: PHP 4,800.00

## Verification Results

| Check | Result |
| --- | --- |
| Migration ledger | Passed: both repository migration versions are recorded exactly |
| Access layering | Passed: platform availability, temporary entitlement, owner-controlled tenant toggle, and server authorization remained separate |
| Direct browser access | Passed: browser roles cannot execute the private feature-selection or sales-order functions directly |
| Draft | Passed: one immutable draft was created with server-resolved customer, location, price list, product, quantity, and price snapshots |
| Draft inventory effect | Passed: on-hand remained 9, reserved remained 0, and available remained 9 |
| Confirm | Passed: status changed to `confirmed`; one +6 reservation ledger entry was appended |
| Shared availability | Passed: on-hand remained 9, reserved became 6, and retail/wholesale shared available stock became 3 |
| Confirm evidence | Passed: exactly one `sales_order.confirmed` audit event and one outbox event exist |
| Cancel remainder | Passed: status changed to `cancelled`; cancelled quantity became 6 and one -6 release entry was appended |
| Final reconciliation | Passed: reservation ledger net is 0, on-hand is 9, reserved is 0, and available is restored to 9 |
| Cancel evidence | Passed: exactly one `sales_order.cancelled` audit event and one outbox event exist |
| Security Advisor | Passed with no warning- or error-level findings; private AW1 tables retain intentional deny-all RLS without browser policies |
| Performance Advisor | No error-level finding; informational foreign-key index candidates remain tracked for measured follow-up |

## Notes

The initial add-on activation exposed a rollout gap: the subscription override correctly granted entitlement but there was no owner workflow for the separate tenant feature toggle. Migration `20261007043637` closes that gap without merging entitlement and enablement. An entitled, active, platform-available add-on now appears in the existing owner feature choices and every change remains audited and outbox-backed.

Supabase advisor references:

- [RLS enabled without policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [Unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)

## Conclusion

AW1 Staging UAT passed. Drafts do not reserve stock; confirmation reserves the same branch-variant inventory used by retail; cancellation releases only the remaining reservation; and all command history is preserved. Production Advanced Wholesale was not deployed or enabled.
