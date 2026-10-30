import {
  paymentQrUploadResponseSchema,
  paymentProofReviewResponseSchema,
  paymentProofUploadResponseSchema,
  productImageArchiveResponseSchema,
  productImageOrderResponseSchema,
  productImageUploadResponseSchema,
  type PaymentQrUploadResponse,
  type PaymentProofReviewRequest,
  type PaymentProofReviewResponse,
  type PaymentProofUploadResponse,
  type ProductImageArchiveResponse,
  type ProductImageOrderResponse,
  type ProductImageUploadResponse,
} from '@hcs/contracts'
import { Client } from 'pg'
import { z } from 'zod'

import type { Bindings } from './env'
import type { StoredImageKey } from './files'
import type { PortalCommand } from './reseller-portal-repository'

/** Metadata of an object the API has already written to storage. */
export interface StoredFileMetadata {
  fileId: string
  mimeType: string
  sizeBytes: number
  thumbSizeBytes?: number
  sha256: string
  originalFilename: string
}

const storedImageKeySchema = z.object({
  productId: z.uuid(),
  fileId: z.uuid(),
  position: z.number().int().nonnegative(),
  storageKey: z.string().min(1),
  thumbStorageKey: z.string().min(1).nullable(),
  variantIds: z.array(z.uuid()),
})
const imagesSchema = z.object({ images: z.array(storedImageKeySchema) })

/** A payment proof as the database returns it, before the API signs and drops its keys. */
export const storedPaymentProofSchema = z.object({
  id: z.uuid(),
  method: z.enum(['gcash', 'bank_transfer']),
  amountMinor: z.number().int().positive(),
  reference: z.string(),
  status: z.enum(['pending', 'accepted', 'rejected']),
  reviewReason: z.string().nullable(),
  createdAt: z.string(),
  reviewedAt: z.string().nullable(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  storageKey: z.string().min(1),
  thumbStorageKey: z.string().min(1).nullable(),
})
export type StoredPaymentProof = z.infer<typeof storedPaymentProofSchema>

const storedPendingProofSchema = storedPaymentProofSchema
  .omit({ status: true, reviewReason: true, reviewedAt: true })
  .extend({
    salesOrderId: z.uuid(),
    orderNumber: z.string(),
    orderStatus: z.string(),
    orderTotalMinor: z.number().int().nonnegative(),
    customerName: z.string(),
  })
export type StoredPendingProof = z.infer<typeof storedPendingProofSchema>

export interface FilesRepository {
  assertProductImageUpload(userId: string, tenantId: string, productId: string, bindings: Bindings): Promise<void>
  assertPaymentQrUpload(userId: string, tenantId: string, accountId: string, bindings: Bindings): Promise<void>
  recordPaymentQr(
    userId: string,
    tenantId: string,
    accountId: string,
    file: StoredFileMetadata,
    command: PortalCommand,
    bindings: Bindings,
  ): Promise<PaymentQrUploadResponse>
  recordProductImage(
    userId: string,
    tenantId: string,
    productId: string,
    file: StoredFileMetadata,
    command: PortalCommand,
    bindings: Bindings,
  ): Promise<ProductImageUploadResponse>
  reorderProductImages(
    userId: string,
    tenantId: string,
    productId: string,
    fileIds: string[],
    requestId: string,
    bindings: Bindings,
  ): Promise<ProductImageOrderResponse>
  archiveProductImage(
    userId: string,
    tenantId: string,
    productId: string,
    fileId: string,
    requestId: string,
    bindings: Bindings,
  ): Promise<ProductImageArchiveResponse>
  listImagesForMember(userId: string, tenantId: string, bindings: Bindings): Promise<StoredImageKey[]>
  listImagesForPos(sessionHash: string, bindings: Bindings): Promise<StoredImageKey[]>
  listImagesForReseller(authUserId: string, tenantId: string, bindings: Bindings): Promise<StoredImageKey[]>
  assertPaymentProofUpload(
    authUserId: string,
    tenantId: string,
    salesOrderId: string,
    bindings: Bindings,
  ): Promise<void>
  recordPaymentProof(
    authUserId: string,
    tenantId: string,
    salesOrderId: string,
    file: StoredFileMetadata & { amountMinor: number; reference: string; method: 'gcash' | 'bank_transfer' },
    command: PortalCommand,
    bindings: Bindings,
  ): Promise<PaymentProofUploadResponse>
  listPendingProofs(userId: string, tenantId: string, bindings: Bindings): Promise<StoredPendingProof[]>
  reviewPaymentProof(
    userId: string,
    tenantId: string,
    proofId: string,
    request: PaymentProofReviewRequest,
    requestId: string,
    bindings: Bindings,
  ): Promise<PaymentProofReviewResponse>
}

function connectionString(bindings: Bindings): string {
  if (!bindings.HYPERDRIVE?.connectionString) throw new Error('HYPERDRIVE binding is not configured.')
  return bindings.HYPERDRIVE.connectionString
}

async function queryOne<T>(bindings: Bindings, text: string, values: unknown[], parse: (value: unknown) => T) {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query(text, values)
    return parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}

const ignore = () => undefined

export const filesPostgresRepository: FilesRepository = {
  assertPaymentQrUpload: (userId, tenantId, accountId, bindings) =>
    queryOne(
      bindings,
      'select app.assert_payment_qr_upload($1::uuid, $2::uuid, $3::uuid)::text response',
      [userId, tenantId, accountId],
      ignore,
    ),
  recordPaymentQr: (userId, tenantId, accountId, file, command, bindings) =>
    queryOne(
      bindings,
      'select app.record_payment_qr($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::text, $6::text, $7::text) response',
      [
        userId,
        tenantId,
        accountId,
        JSON.stringify(file),
        command.idempotencyKey,
        command.requestHash,
        command.requestId,
      ],
      (value) => paymentQrUploadResponseSchema.parse(value),
    ),
  assertProductImageUpload: (userId, tenantId, productId, bindings) =>
    queryOne(
      bindings,
      'select app.assert_product_image_upload($1::uuid, $2::uuid, $3::uuid)::text response',
      [userId, tenantId, productId],
      ignore,
    ),
  recordProductImage: (userId, tenantId, productId, file, command, bindings) =>
    queryOne(
      bindings,
      'select app.record_product_image($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::text, $6::text, $7::text) response',
      [
        userId,
        tenantId,
        productId,
        JSON.stringify(file),
        command.idempotencyKey,
        command.requestHash,
        command.requestId,
      ],
      (value) => productImageUploadResponseSchema.parse(value),
    ),
  reorderProductImages: (userId, tenantId, productId, fileIds, requestId, bindings) =>
    queryOne(
      bindings,
      'select app.reorder_product_images($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::text) response',
      [userId, tenantId, productId, JSON.stringify(fileIds), requestId],
      (value) => productImageOrderResponseSchema.parse(value),
    ),
  archiveProductImage: (userId, tenantId, productId, fileId, requestId, bindings) =>
    queryOne(
      bindings,
      'select app.archive_product_image($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text) response',
      [userId, tenantId, productId, fileId, requestId],
      (value) => productImageArchiveResponseSchema.parse(value),
    ),
  listImagesForMember: (userId, tenantId, bindings) =>
    queryOne(
      bindings,
      'select app.list_catalog_images_for_member($1::uuid, $2::uuid) response',
      [userId, tenantId],
      (value) => imagesSchema.parse(value).images,
    ),
  listImagesForPos: (sessionHash, bindings) =>
    queryOne(
      bindings,
      'select app.list_catalog_images_for_pos($1::text) response',
      [sessionHash],
      (value) => imagesSchema.parse(value).images,
    ),
  listImagesForReseller: (authUserId, tenantId, bindings) =>
    queryOne(
      bindings,
      'select app.list_catalog_images_for_reseller($1::uuid, $2::uuid) response',
      [authUserId, tenantId],
      (value) => imagesSchema.parse(value).images,
    ),
  assertPaymentProofUpload: (authUserId, tenantId, salesOrderId, bindings) =>
    queryOne(
      bindings,
      'select app.assert_payment_proof_upload($1::uuid, $2::uuid, $3::uuid)::text response',
      [authUserId, tenantId, salesOrderId],
      ignore,
    ),
  recordPaymentProof: (authUserId, tenantId, salesOrderId, file, command, bindings) =>
    queryOne(
      bindings,
      'select app.record_payment_proof($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::text, $6::text, $7::text) response',
      [
        authUserId,
        tenantId,
        salesOrderId,
        JSON.stringify(file),
        command.idempotencyKey,
        command.requestHash,
        command.requestId,
      ],
      (value) => paymentProofUploadResponseSchema.parse(value),
    ),
  listPendingProofs: (userId, tenantId, bindings) =>
    queryOne(
      bindings,
      'select app.list_pending_payment_proofs($1::uuid, $2::uuid) response',
      [userId, tenantId],
      (value) => z.object({ proofs: z.array(storedPendingProofSchema) }).parse(value).proofs,
    ),
  reviewPaymentProof: (userId, tenantId, proofId, request, requestId, bindings) =>
    queryOne(
      bindings,
      'select app.review_payment_proof($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::text) response',
      [userId, tenantId, proofId, JSON.stringify(request), requestId],
      (value) => paymentProofReviewResponseSchema.parse(value),
    ),
}
