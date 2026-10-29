# Reseller Portal R1 Recovery Gate

Unreleased runbook for the local candidate; not execution authorization.

## Before Promotion

Apply `20261029013000_reseller_portal_r1.sql` only through the environment-specific gate with a fresh backup and verified restore evidence. The migration is additive: new private tables, nullable or defaulted columns, a relaxed `created_by` / `actor_user_id` NOT NULL replaced by exactly-one-actor checks, and a widened `sales_orders` status check. Existing Back Office orders keep `source = 'backoffice'` and their user actor.

Keep `reseller_portal` disabled for every tenant until Staging UAT passes. The feature is the switch: disabling the entitlement makes every portal and Back Office portal endpoint fail closed (`HCRP0`) without touching data.

## Failure Before Any Portal Order

Disable the entitlement. The new tables may stay empty. Do not drop columns or constraints by hand; any removal needs a reviewed forward migration.

## Failure After Portal Orders Exist

Do not delete or rewrite portal orders, reservation-ledger rows, credit snapshots, applications, accounts, audit or outbox history. Disable new portal submissions by disabling the entitlement. Confirmed portal orders remain ordinary Advanced Wholesale orders and are fulfilled, cancelled or returned through the existing Back Office screens. `submitted` orders reserve nothing; cancel them through a reviewed corrective command if the review queue is unavailable.

An older Back Office build that does not know the `submitted` status will fail to parse the wholesale order list. Roll application code forward, not back, once portal orders exist.

## Files, Product Photos, And Payment Proofs

`20261029080000_files_product_images_payment_proofs.sql` is additive (new private tables and functions, and a replaced `app.reseller_order_json` that adds payment proofs). Without the `FILES` binding or `FILES_URL_SECRET`, uploads answer 503 and every catalog, POS and portal read still works without photos, so withholding those two settings is the switch. Never delete file records or R2 objects to undo an upload: archive photos through the API, and correct a wrongly verified proof through a reviewed corrective command, since verification does not move money. Rotating `FILES_URL_SECRET` only invalidates outstanding links.
