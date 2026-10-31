# Files, Product Photos, and Payment Proofs

Status: source candidate on `codex/files-product-images-payment-proofs` (based on Reseller Portal R1); not merged, migrated, or deployed

Date: 2026-10-29

Owner direction: "proceed sa dev yan product pictures at proof of payment" (2026-10-29)

## Purpose

One file-storage foundation (PROJECT_SPEC file storage: tenant-isolated records, audited uploads, archive instead of delete, thumbnails) serving two first uses:

- **Product photos**: set up once on the Back Office product page and shown on the product list, POS item tiles, and the reseller catalog.
- **Payment proofs**: resellers attach a GCash or bank-transfer screenshot or PDF, with amount and reference, to an order; the Back Office verifies or rejects it.

## Storage model

- Bytes live in Cloudflare R2 (Worker binding `FILES`). PostgreSQL keeps `app.files` records only.
- Storage keys are derived in the database as `t/<tenant>/<kind>/<file id>/<main|thumb>`; a check constraint rejects any other key, so a record can never point at another tenant's object.
- File records are immutable apart from archiving. Deleting a record is refused by trigger.
- Browsers never receive storage keys or bucket access. The API returns short-lived signed paths (`/v1/files/content?key&exp&sig`, HMAC-SHA256 with the Worker secret `FILES_URL_SECRET`). Product photo links share a 6-hour window and stay valid for at least 18 hours, so they cache well. Payment proof links expire within about 15 minutes.
- Served files carry `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, and `Content-Disposition: inline`.

## Upload rules

| | Product photo | Payment proof |
| --- | --- | --- |
| Who | Owner or `catalog.manage` | The reseller who owns the order |
| Types (checked from the bytes) | JPEG, PNG, WebP | JPEG, PNG, WebP, or PDF |
| Size | 2.5 MB main, 512 KB thumbnail (browser resizes to 1600 px and 400 px) | 5 MB; images also get a thumbnail |
| Limit | 8 active photos per product | 5 pending proofs per order |
| Extra fields | none | method (GCash / bank transfer), amount, reference (4–64 characters) |

The API checks permission and limits before storing any bytes, stores the objects, then records the file. If recording fails, the new objects are deleted. An idempotent retry answers with the first file and removes the duplicate bytes.

## Locked behavior

- The first active photo is the primary photo. Reordering must list every current photo exactly once.
- Removing a photo archives the file; the object remains for audit.
- Photo URLs are decoration. When signing is not configured or the photo lookup fails, catalog, POS and portal responses still load without photos.
- Accepting a payment proof marks it verified only. It never posts money, allocates receivables, or changes the order. Payments are still recorded through the audited wholesale payment and paid-fulfillment commands, using the proof's reference. Rejecting requires a reason the reseller sees.
- Every upload, reorder, archive and review writes an audit event and an outbox event. Reseller uploads use the `system` actor with the reseller identity in metadata, as in R1.

## Before Staging

- Create an R2 bucket per environment and bind it as `FILES` on the API Worker.
- Set `FILES_URL_SECRET` as a Worker secret (at least 32 random bytes); rotating it invalidates outstanding links only.
- Apply `20261029080000_files_product_images_payment_proofs.sql` through the normal gate, after the R1 migration.

## Not in this slice

- Expense receipts, supplier documents, delivery and return evidence (same foundation, later slices).
- Recording a payment directly from a verified proof (needs owner approval because it posts money).
- Server-side image processing; resizing happens in the browser.
