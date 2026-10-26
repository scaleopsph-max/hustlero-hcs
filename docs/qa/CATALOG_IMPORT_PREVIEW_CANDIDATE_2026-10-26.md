# Catalog Import Preview Candidate

Intermediate head 6c2c2b68ae964019af89ee9876ad833b54de8c51 passed push/PR CI
40316428903 / 40316435288. Follow-up self-review found entitlement expiry during
product wrapper request-key waits could still return historical success. Added
create/update overlap regressions in test-only ffcffa5; two post-key-lock access
checks in the new, never-hosted category migration correct that edge. Red checkpoint
ffcffa531573d0f373b671543a59a9623a8726d6 failed both push/PR CI 40316661076 /
40316666851 exactly on create historical replay: actual unexpected-success versus
expected HCS10 after the real key-lock wait. Reset, 1,968 pgTAP assertions and
earlier overlaps passed, and cleanup completed. Update is covered by the same
regression loop, but stopped after the first red create assertion; do not claim
both failed independently. Fixed-head green CI remains pending. No applied
migration or frozen hosted helper was rewritten. Preview row details now expose
category, cost, tracking, retained barcodes and description before any future post.

Continuation of the approved five-slice source batch on draft PR #10. This is a
read-only vertical preview slice, NOT a completed importer or authorization to
create products. Category manager's prior exact CI is recorded separately.

## Implemented

- Downloadable structured CSV template with explicit product_sku grouping; file
  size/row/header checks using Papa Parse, not split-on-comma parsing.
- Framework-independent planner uses SKU identities, not product names. Explicit
  parent SKUs allow new variants under existing products or new file groups even
  when the parent appears later. Conflicting metadata across aliases of the same
  existing product is rejected; existing variants cannot move to a new parent.
- Exact decimal-to-centavo conversion with bounded BigInt intermediates. Duplicate
  SKU/barcode, inactive items, missing/archived categories, invalid tracking/price,
  merged-barcode limits and dependent rejected-parent rows fail validation. Existing
  barcodes are preserved; import cannot silently change existing tracking mode.
- Strict authenticated POST /v1/catalog/imports/preview; 6 MB transport bound,
  5,000 rows and 2,000-character raw-field limit. No client plan or tenant body
  accepted. Existing authorized tenant is selected through verified server access.
- Migration 20261026112216 adds only a guarded snapshot read. Catalog management
  permission is required, including on inactive-item conflict detection. Snapshot
  is limited to requested SKUs/parent SKUs, barcode owners and category names;
  it does not load the whole tenant catalog. Query uses tenant-scoped indexed
  identities and keeps inactive variants instead of treating them as new SKUs.
- /products/import provides template, upload, server preview, per-row validation,
  intent totals and exact money display. Selecting a different file or a failed
  refresh clears old preview. Original account and response filename are checked.
  There is intentionally no Import/Post button or simulated successful import.

## Verification Checkpoint

Focused new tests passed: 31 planner, nine CSV, ten API and six component DOM cases.
Cases include the 5,000-row maximum, structured quoted CSV, limits, unauthorized
tenant/reader, inactive ownership, no stock columns, stale preview clearing and
wrong-account/filename rejection. Test typing/lint defects were corrected without
relaxing compiler/linter settings. Final full local check passed 1,073 app tests /
55 files, 47 simulated harness cases, formatting, lint, typechecks and all standard/
Cloudflare builds (exit 0), including the final reader-denial UI/test. Exact SQL CI
remains pending at this source-document checkpoint.

Playwright/Edge actual preview UI with real CSV/domain parsing and mocked Auth/API
snapshot passed template download, grouped preview/exact amounts, stock-column
rejection, desktop 1440/mobile 390, screenshots and no overflow/page errors/external
requests. Standards-mode screenshot was inspected. This is not a hosted sign-in,
database posting, job processing or live financial/inventory test.

New pgTAP cases cover relevant/inactive/archived snapshot data, tenant isolation,
catalog.read denial versus manage, function grants, no audit/outbox/stock mutation
and suspended-tenant denial. SQL execution is pending exact disposable CI.

## Remaining Import Work

Durable preview/job history, immutable confirmed request/snapshot identity,
asynchronous processing, per-row posting/results, baseline-change revalidation,
lost-response recovery, cancellation/resume semantics and atomic per-command
write reconciliation are NOT implemented by this read-only slice. Posting must
revalidate current permissions, catalog state and duplicates; this transient
preview is not a reusable posting authorization. No stock writes belong here.

Discounts, PCOUNT and supplier enhancements remain subsequent core slices.
Modifiers/Productions remain deferred. No live migration, deployment, secret/access
grant, main merge or policy bypass. Frozen hosted helper/manifests unchanged.
