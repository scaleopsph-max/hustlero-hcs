# Retail Ticket Discounts V1

Owner confirmed October 27, following the approved five-slice source blueprint:

- One predefined fixed/percentage discount on the whole retail POS ticket.
- No stacking, manual overrides, wholesale/dealer/mixed ticket or loyalty redemption.
- Reject nonzero tax snapshots; no tax-rate rewrite or implied statutory discount.
- Percent half-up to cents; stable line-ID cumulative proportional allocation
  against original gross line amounts. Exact immutable snapshots for refunds/reports.
- Reject zero-cent discounts and discounts that leave no positive payable amount;
  no silent cap, 100% definition or free-ticket workflow.
- Dedicated discounts.manage (default Owner/Admin/Manager) and discounts.apply
  (also authorized Cashier). Apply never implies manage. Generic capability
  templates remain authoritative; PCOUNT's role exception does not extend here.

## Planned Configuration Increment

Versioned configuration and private authorized API/Back Office management will use
the pure quote computation. Definition updates must be optimistic-revision checked and retain
append-only snapshots. Unknown command outcomes retain original key/body; exact
revision reads prove historical retries even after subsequent edits/archive.
Use existing Sales entitlement; no new subscription, feature add-on or paid resource.

## Current Source Boundary

Implemented at this checkpoint: strict command/definition contracts and a pure
integer quote engine, with original definition snapshots, proportional per-line
amounts and positive-payable enforcement. Contracts describe future commands;
they do not by themselves expose an endpoint or grant permissions.

The next source candidate adds database configuration, guarded private API,
manager UI and durable exact-version command recovery. Verification is recorded
in `../qa/RETAIL_DISCOUNT_CONFIGURATION_2026-10-27.md`; source presence is not
hosted migration/deployment evidence.

POS selection/checkout authorization and immutable sale-line discount posting,
snapshot-based partial/full refunds and linked discount reporting are the next
integration increment. No existing POS checkout or retail reversal restriction
is loosened in configuration work. A zero-net line may occur through allocation;
zero-only refund/restock semantics must remain blocked by existing rules until
explicitly defined, never converted to a fake positive payout.

All work is source/isolated QA only. No hosted migration, deployment, credential,
access grant, financial UAT, Production change or policy workaround is authorized.
