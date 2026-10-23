# AW3 / AW4 Release Preflight: October 19, 2026

Owner requested AW4 deployment and an AW3 check. Interpret the immediate target as Staging; no Production promotion or prerequisite bypass is inferred.

## Fresh Read-Only Evidence

The connected Supabase migration-list tool returned 65 installed Staging migrations on `sdfwdhbryjyfufgtfqmf`, ending `20261012152656_reporting_branch_read_scope`. Production `gmprhuzbisfylidjpfob` returned 51, ending `20261008045840_advanced_wholesale_partial_fulfillment_invoices`.

Thus the existing reviewed-main integration still has fifteen migrations pending on Staging and twenty-nine pending on Production. AW4 adds `20261018123241_advanced_wholesale_return_credit_posting` as a separate candidate: sixteen and thirty respectively if this migration is approved after review. Migration listings establish installed inventory, not complete schema equivalence, backup freshness or application version.

## Release Hold

- AW4 is currently unmerged feature source, not an immutable CI-verified main release.
- Actual pgTAP and AW4 simultaneous-session races must pass in disposable CI. Added over-return, credit-overdraw and original-key return/application replay scenarios to the existing fixed-loopback CI runner; not claimed passed until execution.
- Populated authenticated UI/recovery checks and independent review remain required.
- The prior guarded AW3 migration launch was blocked by policy. No supported resolution is recorded. This preflight did not retry it through another launcher/tool, widen credentials or apply SQL.
- The approved fifteen-migration AW3 execution budget cannot silently become a sixteen-migration AW3/AW4 batch.

Prepare the feature candidate and draft PR for source/database CI first. Resolve the existing AW3 execution restriction through supported review, then recheck exact source/history, backup and compatible app artifacts before any Staging cutover. Do not upload an AW4 API/Back Office against the older schema.

No hosted SQL writes, token creation/use, financial test, access grant, paid resource, Worker upload, main merge or Production change occurred during this preflight.
