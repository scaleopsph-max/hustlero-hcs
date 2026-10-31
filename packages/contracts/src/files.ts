import { z } from 'zod'

const uuid = z.uuid()
const timestamp = z.string().min(1)
/** API-relative signed path such as `/v1/files/content?...`; clients prefix their API URL. */
export const signedFilePathSchema = z.string().regex(/^\/v1\/files\/content\?/)

export const productImageSchema = z.object({
  fileId: uuid,
  position: z.number().int().nonnegative(),
  url: signedFilePathSchema,
  thumbUrl: signedFilePathSchema,
})

export const productImageUploadResponseSchema = z.object({
  fileId: uuid,
  productId: uuid,
  position: z.number().int().nonnegative(),
  status: z.literal('uploaded'),
})

export const productImageOrderRequestSchema = z.strictObject({
  fileIds: z
    .array(uuid)
    .min(1)
    .max(8)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Each photo may appear once.' }),
})

export const productImageOrderResponseSchema = z.object({
  productId: uuid,
  status: z.literal('reordered'),
  primaryFileId: uuid,
})

export const productImageArchiveResponseSchema = z.object({
  productId: uuid,
  fileId: uuid,
  status: z.literal('archived'),
})

export const paymentProofMethodSchema = z.enum(['gcash', 'bank_transfer'])
export const paymentProofStatusSchema = z.enum(['pending', 'accepted', 'rejected'])

/** Text fields of the multipart proof upload; the file parts are checked by the API. */
export const paymentProofFieldsSchema = z.strictObject({
  method: paymentProofMethodSchema,
  amountMinor: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  reference: z.string().trim().min(4).max(64),
})

export const paymentProofSchema = z.object({
  id: uuid,
  method: paymentProofMethodSchema,
  amountMinor: z.number().int().positive(),
  reference: z.string().min(1),
  status: paymentProofStatusSchema,
  reviewReason: z.string().nullable(),
  createdAt: timestamp,
  reviewedAt: timestamp.nullable(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  url: signedFilePathSchema,
  thumbUrl: signedFilePathSchema.nullable(),
})

export const paymentProofUploadResponseSchema = z.object({
  proofId: uuid,
  fileId: uuid,
  salesOrderId: uuid,
  status: z.literal('pending'),
  amountMinor: z.number().int().positive(),
  method: paymentProofMethodSchema,
})

export const pendingPaymentProofSchema = paymentProofSchema
  .omit({ status: true, reviewReason: true, reviewedAt: true })
  .extend({
    salesOrderId: uuid,
    orderNumber: z.string().min(1),
    orderStatus: z.string().min(1),
    orderTotalMinor: z.number().int().nonnegative(),
    customerName: z.string().min(1),
  })

export const pendingPaymentProofsSchema = z.object({ proofs: z.array(pendingPaymentProofSchema) })

export const paymentProofReviewRequestSchema = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('accept'), reason: z.string().trim().min(2).max(500).optional() }),
  z.strictObject({ decision: z.literal('reject'), reason: z.string().trim().min(2).max(500) }),
])

export const paymentProofReviewResponseSchema = z.object({
  proofId: uuid,
  salesOrderId: uuid,
  status: z.enum(['accepted', 'rejected']),
})

export type ProductImage = z.infer<typeof productImageSchema>
export type ProductImageUploadResponse = z.infer<typeof productImageUploadResponseSchema>
export type ProductImageOrderRequest = z.infer<typeof productImageOrderRequestSchema>
export type ProductImageOrderResponse = z.infer<typeof productImageOrderResponseSchema>
export type ProductImageArchiveResponse = z.infer<typeof productImageArchiveResponseSchema>
export type PaymentProofFields = z.infer<typeof paymentProofFieldsSchema>
export type PaymentProof = z.infer<typeof paymentProofSchema>
export type PaymentProofUploadResponse = z.infer<typeof paymentProofUploadResponseSchema>
export type PendingPaymentProof = z.infer<typeof pendingPaymentProofSchema>
export type PendingPaymentProofs = z.infer<typeof pendingPaymentProofsSchema>
export type PaymentProofReviewRequest = z.infer<typeof paymentProofReviewRequestSchema>
export type PaymentProofReviewResponse = z.infer<typeof paymentProofReviewResponseSchema>
