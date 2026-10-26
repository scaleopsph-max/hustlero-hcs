# Category Manager Source Candidate

Owner approved five core operations slices with APPROVED BLUEPRINT - PROCEED TO
BUILD on October 26. Branch codex/catalog-inventory-operations starts at main
b45b1f6. This first slice is Categories; catalog import, discounts, PCOUNT and
supplier improvements are not claimed complete. Modifiers/Productions deferred.
Owner/Manager create/post PCOUNT, explicitly authorized other staff may count;
exact posting/concurrent-stock and discount-use questions remain separate.

## Implemented

- Categories page linked from Products; search, create, rename, archive, counts
  of product/pricing references, read-only/error/empty/recovery states.
- Product add/edit selects existing active category UUID; no free-text creation.
- Strict category command contracts and authenticated tenant-selected API routes.
- Migration 20261026075159 adds locked catalog access, authorized context/commands,
  actor-bound idempotency/audit/outbox, active-category guards and selected-category
  wrappers around existing product cores. Old browser roles have no direct access;
  API core grants are replaced with explicit wrappers, not bypassed through SQL.
- Existing active legacy category names remain accepted by wrappers but cannot
  create categories. Legacy raw request hashes are preserved for historical replay;
  new ID-based writes bind actor/hash. Completed replay precedes category resolution,
  so rename/archive cannot silently produce a replacement product or category.
- Archive rejects active product or any pricing-group references. Category row
  locking serializes rename/archive/assignment; original IDs/history are preserved.
- Exact saved key/body survives response/history failure and reload. Unknown/auth/
  key conflicts retain recovery; definite duplicate/archive/reference rejection
  allows explicit dismissal. Full original identity is checked before clearing.

## Verification Checkpoint

Local full check passed 1,017 app tests in 51 files and 47 simulated harness cases,
format/lint/typechecks and standard/Cloudflare builds. New focused API/helper 27
and DOM 10 tests passed. Browser actual Categories component with mocked Auth/API
passed create lost-response/reload/replay, rename/archive, reference guard, desktop
1440/mobile 390, screenshots and no page errors/external requests/overflow.
Harness was corrected from quirks mode to a standards-mode doctype and layout
font-variable fallbacks; screenshots were inspected. No hosted sign-in claimed.

Added pgTAP category isolation/permission/idempotency/archive/assignment cases and
six independent-session checks to the existing loopback-only disposable CI harness:
archive-first, assignment-first, rename-first, same-key overlap, queued suspension
and expiry during category wait. Script syntax passed; SQL/concurrency execution
remains pending exact CI at this checkpoint. Two existing privilege assertions now
check the replacement wrapper surface; direct core execution is explicitly denied.

## Release Boundary

One new ordered migration; no old migration rewritten. No live migration, secrets,
access grants, financial fixture, deployment, main merge or policy workaround.
Existing hosted helper/manifest remains unchanged. Current app must not deploy
before its matching schema. Restore previous app and validated backup only through
approved release procedures; prefer forward corrective migrations preserving
category/audit/outbox/idempotency history, never destructive table/ledger cleanup.
