# Catalog Import Closeout Candidate

Execution baseline c6efe6309b1b60ebc08e61151ceccbe0921d775f passed exact push CI
40440993436 and PR CI 40440999569: 1,152 app tests / 61 files, 47 harness cases,
2,062 database assertions / 58 files, reset, prior and new execution concurrency,
and cleanup. No hosted migration or deployment. Earlier red checkpoints remain
documented in CATALOG_IMPORT_EXECUTION_CANDIDATE_2026-10-27.md.

## Closeout Increment

- Downloadable source-row result CSV, actual posted IDs/outcomes and explicitly
  planned prices/costs. Unprocessed rows are pending, not fake successes/failures.
- Exact integer/BigInt money formatting, shared reportCsv structured escaping,
  spreadsheet formula protection and text preservation for numeric SKU identities.
- Export performs an authorized fresh execution read/reconciliation. Denied access
  clears displayed execution and never falls back to downloading cached results.
- Catalog responses use private/no-store headers; browser import fetches bypass cache.
- Reconciliation rejects duplicate posted variant identities and different product
  groups falsely sharing a single created product.
- Result table composite foreign keys enforce tenant-scoped product and variant references.
- Additional QA: 25-group Continue ceiling, next-index resume and pause after the
  current group; shared-product parent aliases; stale barcode/category admission;
  full 5,000-group review under a 30-second statement ceiling (not a claim that
  all 5,000 groups were posted in one request).

Self-review found primary-barcode preservation depended on random UUID ordering
in the never-hosted preview snapshot. Corrected it to primary-first ordering.
Added fixtures with a secondary barcode whose UUID sorts first and a real import
update asserting the original primary and secondary barcode remain unchanged.
No applied/frozen migration or historical release helper was modified.

## Evidence Checkpoint

Focused export suite initially passed 28 cases; subsequent execution/export/API
suite passed 66 cases, including bounded continuation/pause and identity guards.
Actual source component browser flow at 1440/390 passed downloadable CSV parsing,
exact 499.99/200.01 values/shared product IDs, confirmation, completed reload,
pending cleanup and no document overflow/page errors/external requests. Auth/API
persistence was mocked; this is not hosted UAT. The browser fixture now awaits
confirmed state before asserting cancellation is unavailable.

Final local full checks and exact closeout SQL/CI remain pending at this source
checkpoint. Keep PR #10 draft/unmerged; no hosted secrets, paid resources,
financial commands, inventory writes, deployment or policy bypass authorized.
