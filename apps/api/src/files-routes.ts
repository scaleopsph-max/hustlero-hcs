import {
  apiErrorResponseSchema,
  paymentProofFieldsSchema,
  paymentProofReviewRequestSchema,
  pendingPaymentProofsSchema,
  productImageOrderRequestSchema,
  type CatalogResponse,
  type PaymentProof,
  type PosSalesContext,
  type ResellerOrder,
  type ResellerPortalCatalog,
} from '@hcs/contracts'
import type { Context, Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { readBearerToken, type AccessTokenVerifier } from './auth'
import type { Bindings } from './env'
import {
  PAYMENT_PROOF_MAX_BYTES,
  PRODUCT_IMAGE_MAX_BYTES,
  THUMB_MAX_BYTES,
  UPLOAD_REQUEST_MAX_BYTES,
  createFileUrlSigner,
  detectMime,
  paymentProofExpiry,
  productImageExpiry,
  sha256Hex,
  signProductImages,
  storageKey,
  verifyFileUrl,
  type FileBucket,
  type FileUrlSigner,
  type SignedProductImage,
  type StoredImageKey,
  type StoredMime,
} from './files'
import type { FilesRepository, StoredPaymentProof } from './files-repository'
import type { StoredResellerOrder } from './reseller-portal-repository'

type AppContext = Context<{ Bindings: Bindings }>

export interface FileRouteDependencies {
  verifyAccessToken: AccessTokenVerifier
  resolveBackofficeTenant: (context: AppContext) => Promise<{ userId: string; tenantId: string } | null>
  repository: FilesRepository
  bucket: (bindings: Bindings) => FileBucket | null
  requestHash: (value: unknown) => Promise<string>
  postgresErrorCode: (error: unknown) => string | null
  now?: () => number
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const idempotencyPattern = /^[A-Za-z0-9_-]{16,128}$/
const nowSeconds = (dependencies: { now?: () => number }) => Math.floor((dependencies.now?.() ?? Date.now()) / 1000)

const errorMap: Record<string, { status: ContentfulStatusCode; code: string; message: string }> = {
  HCFL1: { status: 403, code: 'FILE_ACCESS_DENIED', message: 'You do not have permission to change these files.' },
  HCFL2: { status: 400, code: 'INVALID_FILE', message: 'Check the file and its details.' },
  HCFL3: {
    status: 404,
    code: 'FILE_TARGET_NOT_FOUND',
    message: 'The product, order, payment account, or photo was not found.',
  },
  HCFL4: {
    status: 409,
    code: 'FILE_LIMIT_REACHED',
    message: 'The file limit was reached. Remove or wait for review first.',
  },
  HCFL5: { status: 409, code: 'PAYMENT_PROOF_NOT_ACCEPTED', message: 'This order cannot take a payment proof.' },
  HCFL6: {
    status: 409,
    code: 'PAYMENT_WINDOW_CLOSED',
    message: 'The 4-hour payment window for this order has closed. Place the order again.',
  },
  HCRP0: { status: 404, code: 'RESELLER_PORTAL_UNAVAILABLE', message: 'The reseller portal is not available.' },
  HCRP1: { status: 403, code: 'RESELLER_ACCESS_DENIED', message: 'This account does not have reseller access here.' },
  HCRP3: { status: 400, code: 'INVALID_RESELLER_PORTAL_REQUEST', message: 'Check the details and try again.' },
  HCRA1: {
    status: 403,
    code: 'RESELLER_PORTAL_ADMIN_DENIED',
    message: 'Reseller portal management permission is required.',
  },
  HCRA4: { status: 404, code: 'RESELLER_RECORD_NOT_FOUND', message: 'The payment proof was not found.' },
  HCRA5: { status: 409, code: 'RESELLER_RECORD_ALREADY_DECIDED', message: 'This payment proof was already reviewed.' },
  HCS08: {
    status: 409,
    code: 'IDEMPOTENCY_KEY_CONFLICT',
    message: 'This request key was already used for a different request.',
  },
}

/** Signs a stored proof and drops its storage keys. */
export async function presentPaymentProof(
  proof: StoredPaymentProof,
  signer: FileUrlSigner,
  now: number,
): Promise<PaymentProof> {
  const expiresAt = paymentProofExpiry(now)
  const { storageKey: key, thumbStorageKey, ...rest } = proof
  return {
    ...rest,
    url: await signer.sign(key, expiresAt),
    thumbUrl: thumbStorageKey ? await signer.sign(thumbStorageKey, expiresAt) : null,
  }
}

/** Converts stored orders to their contract form: proofs signed, or omitted when signing is not configured. */
export async function presentOrders(
  orders: StoredResellerOrder[],
  bindings: Bindings,
  now: number,
): Promise<ResellerOrder[]> {
  const signer = bindings.FILES_URL_SECRET ? createFileUrlSigner(bindings.FILES_URL_SECRET) : null
  return Promise.all(
    orders.map(async ({ paymentProofs, ...order }) => ({
      ...order,
      paymentProofs: signer
        ? await Promise.all((paymentProofs ?? []).map((proof) => presentPaymentProof(proof, signer, now)))
        : [],
    })),
  )
}

/**
 * Adds signed photo URLs to a catalog-shaped response. Photos are decoration: when signing is not
 * configured or the photo lookup fails, the catalog still loads without them.
 */
async function withImages<T>(
  bindings: Bindings,
  now: number,
  list: () => Promise<StoredImageKey[]>,
  apply: (byProduct: Map<string, SignedProductImage[]>, images: StoredImageKey[]) => T,
  fallback: T,
): Promise<T> {
  if (!bindings.FILES_URL_SECRET) return fallback
  try {
    const images = await list()
    return apply(await signProductImages(images, createFileUrlSigner(bindings.FILES_URL_SECRET), now), images)
  } catch (error) {
    console.warn('Product photos were skipped for this response.', error instanceof Error ? error.message : error)
    return fallback
  }
}

export function decorateBackofficeCatalog(
  repository: FilesRepository,
  catalog: CatalogResponse,
  userId: string,
  tenantId: string,
  bindings: Bindings,
  now: number,
) {
  return withImages(
    bindings,
    now,
    () => repository.listImagesForMember(userId, tenantId, bindings),
    (byProduct) => ({
      ...catalog,
      products: catalog.products.map((product) => ({ ...product, images: byProduct.get(product.id) ?? [] })),
    }),
    catalog,
  )
}

export function decoratePosContext(
  repository: FilesRepository,
  context: PosSalesContext,
  sessionHash: string,
  bindings: Bindings,
  now: number,
) {
  return withImages(
    bindings,
    now,
    () => repository.listImagesForPos(sessionHash, bindings),
    (byProduct, images) => {
      const productOfVariant = new Map(
        images.flatMap((image) => image.variantIds.map((variantId) => [variantId, image.productId])),
      )
      return {
        ...context,
        items: context.items.map((item) => {
          const productId = productOfVariant.get(item.variantId)
          return { ...item, imageThumbUrl: (productId && byProduct.get(productId)?.[0]?.thumbUrl) || null }
        }),
      }
    },
    context,
  )
}

export function decorateResellerCatalog(
  repository: FilesRepository,
  catalog: ResellerPortalCatalog,
  authUserId: string,
  tenantId: string,
  bindings: Bindings,
  now: number,
) {
  return withImages(
    bindings,
    now,
    () => repository.listImagesForReseller(authUserId, tenantId, bindings),
    (byProduct) => ({
      ...catalog,
      items: catalog.items.map((item) => {
        const primary = byProduct.get(item.productId)?.[0]
        return { ...item, imageUrl: primary?.url ?? null, thumbUrl: primary?.thumbUrl ?? null }
      }),
    }),
    catalog,
  )
}

type Upload = { bytes: Uint8Array<ArrayBuffer>; mime: StoredMime; sha256: string; filename: string }

export function registerFileRoutes(app: Hono<{ Bindings: Bindings }>, dependencies: FileRouteDependencies) {
  const fail = (context: AppContext, status: ContentfulStatusCode, code: string, message: string) =>
    context.json(
      apiErrorResponseSchema.parse({ error: { code, message, requestId: context.get('requestId') } }),
      status,
    )

  const mapError = (context: AppContext, error: unknown) => {
    const code = dependencies.postgresErrorCode(error)
    const mapped = code ? errorMap[code] : undefined
    return mapped ? fail(context, mapped.status, mapped.code, mapped.message) : null
  }

  const storage = (context: AppContext) => {
    const bucket = dependencies.bucket(context.env)
    if (!bucket || !context.env.FILES_URL_SECRET) return null
    return bucket
  }

  /** Reads one file part, checking its size and its real type from the bytes. */
  async function readPart(
    value: unknown,
    maxBytes: number,
    allowed: StoredMime[],
  ): Promise<Upload | 'missing' | 'too_large' | 'wrong_type'> {
    if (!(value instanceof File)) return 'missing'
    if (value.size < 1) return 'missing'
    if (value.size > maxBytes) return 'too_large'
    const bytes = new Uint8Array(await value.arrayBuffer())
    const mime = detectMime(bytes)
    if (!mime || !allowed.includes(mime)) return 'wrong_type'
    const filename = (value.name || 'upload').replace(/[^\w.\- ]+/g, '_').slice(0, 200) || 'upload'
    return { bytes, mime, sha256: await sha256Hex(bytes), filename }
  }

  const partProblem = (
    context: AppContext,
    result: 'missing' | 'too_large' | 'wrong_type',
    label: string,
    maxBytes: number,
  ) =>
    result === 'too_large'
      ? fail(context, 413, 'FILE_TOO_LARGE', `The ${label} is larger than ${Math.round(maxBytes / 1048576)} MB.`)
      : result === 'wrong_type'
        ? fail(
            context,
            415,
            'FILE_TYPE_NOT_ALLOWED',
            `The ${label} must be a JPEG, PNG or WebP image${label === 'payment proof' ? ' or a PDF' : ''}.`,
          )
        : fail(context, 400, 'FILE_REQUIRED', `Attach the ${label}.`)

  async function readForm(context: AppContext) {
    const length = Number(context.req.header('content-length') ?? '0')
    if (length > UPLOAD_REQUEST_MAX_BYTES) return 'too_large' as const
    if (!(context.req.header('content-type') ?? '').startsWith('multipart/form-data')) return 'invalid' as const
    try {
      return await context.req.parseBody()
    } catch {
      return 'invalid' as const
    }
  }

  async function putAll(bucket: FileBucket, objects: { key: string; upload: Upload }[]) {
    await Promise.all(
      objects.map(({ key, upload }) => bucket.put(key, upload.bytes, { httpMetadata: { contentType: upload.mime } })),
    )
  }

  // Signed content -----------------------------------------------------------

  app.get('/v1/files/content', async (context) => {
    const bucket = storage(context)
    if (!bucket) return fail(context, 503, 'FILES_NOT_CONFIGURED', 'File storage is not configured.')
    const key = await verifyFileUrl(
      context.env.FILES_URL_SECRET ?? '',
      context.req.query('key'),
      context.req.query('exp'),
      context.req.query('sig'),
      nowSeconds(dependencies),
    )
    if (!key) return fail(context, 404, 'FILE_LINK_INVALID', 'This file link is invalid or has expired.')
    const object = await bucket.get(key)
    if (!object) return fail(context, 404, 'FILE_NOT_FOUND', 'The file was not found.')
    const remaining = Math.max(0, Number(context.req.query('exp')) - nowSeconds(dependencies))
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        'Cache-Control': `private, max-age=${Math.min(remaining, 86400)}, immutable`,
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    })
  })

  // Product photos (Back Office) --------------------------------------------

  app.post('/v1/catalog/products/:productId/images', async (context) => {
    const admin = await dependencies.resolveBackofficeTenant(context)
    if (!admin) return fail(context, 403, 'FILE_ACCESS_DENIED', 'Sign in and select a business to upload photos.')
    const productId = context.req.param('productId')
    const key = context.req.header('idempotency-key')
    if (!uuidPattern.test(productId) || !key || !idempotencyPattern.test(key))
      return fail(context, 400, 'INVALID_FILE', 'Provide a valid product and Idempotency-Key.')
    const bucket = storage(context)
    if (!bucket) return fail(context, 503, 'FILES_NOT_CONFIGURED', 'File storage is not configured.')
    const form = await readForm(context)
    if (form === 'too_large') return partProblem(context, 'too_large', 'upload', UPLOAD_REQUEST_MAX_BYTES)
    if (form === 'invalid') return fail(context, 400, 'INVALID_FILE', 'Send the photo as multipart form data.')
    const images: StoredMime[] = ['image/jpeg', 'image/png', 'image/webp']
    const main = await readPart(form.image, PRODUCT_IMAGE_MAX_BYTES, images)
    if (typeof main === 'string') return partProblem(context, main, 'photo', PRODUCT_IMAGE_MAX_BYTES)
    const thumb = await readPart(form.thumb, THUMB_MAX_BYTES, images)
    if (typeof thumb === 'string') return partProblem(context, thumb, 'thumbnail', THUMB_MAX_BYTES)

    try {
      // Check permission and the photo limit before any bytes are stored.
      await dependencies.repository.assertProductImageUpload(admin.userId, admin.tenantId, productId, context.env)
      const fileId = crypto.randomUUID()
      const keys = [
        storageKey(admin.tenantId, 'product_image', fileId, 'main'),
        storageKey(admin.tenantId, 'product_image', fileId, 'thumb'),
      ]
      await putAll(bucket, [
        { key: keys[0] as string, upload: main },
        { key: keys[1] as string, upload: thumb },
      ])
      try {
        const response = await dependencies.repository.recordProductImage(
          admin.userId,
          admin.tenantId,
          productId,
          {
            fileId,
            mimeType: main.mime,
            sizeBytes: main.bytes.length,
            thumbSizeBytes: thumb.bytes.length,
            sha256: main.sha256,
            originalFilename: main.filename,
          },
          {
            idempotencyKey: key,
            requestHash: await dependencies.requestHash({ productId, main: main.sha256, thumb: thumb.sha256 }),
            requestId: context.get('requestId'),
          },
          context.env,
        )
        // A replayed request answers with the first upload; the bytes just written are not needed.
        if (response.fileId !== fileId) await bucket.delete(keys)
        return context.json(response, 201)
      } catch (error) {
        await bucket.delete(keys).catch(() => undefined)
        throw error
      }
    } catch (error) {
      const response = mapError(context, error)
      if (response) return response
      throw error
    }
  })

  // Payment QR images (Back Office reseller portal settings) -------------------

  app.post('/v1/reseller-portal/payment-accounts/:accountId/qr', async (context) => {
    const admin = await dependencies.resolveBackofficeTenant(context)
    if (!admin) return fail(context, 403, 'FILE_ACCESS_DENIED', 'Sign in and select a business to upload a QR code.')
    const accountId = context.req.param('accountId')
    const key = context.req.header('idempotency-key')
    if (!uuidPattern.test(accountId) || !key || !idempotencyPattern.test(key))
      return fail(context, 400, 'INVALID_FILE', 'Provide a valid payment account and Idempotency-Key.')
    const bucket = storage(context)
    if (!bucket) return fail(context, 503, 'FILES_NOT_CONFIGURED', 'File storage is not configured.')
    const form = await readForm(context)
    if (form === 'too_large') return partProblem(context, 'too_large', 'upload', UPLOAD_REQUEST_MAX_BYTES)
    if (form === 'invalid') return fail(context, 400, 'INVALID_FILE', 'Send the QR code as multipart form data.')
    const images: StoredMime[] = ['image/jpeg', 'image/png', 'image/webp']
    const main = await readPart(form.image, PRODUCT_IMAGE_MAX_BYTES, images)
    if (typeof main === 'string') return partProblem(context, main, 'QR code', PRODUCT_IMAGE_MAX_BYTES)

    try {
      await dependencies.repository.assertPaymentQrUpload(admin.userId, admin.tenantId, accountId, context.env)
      const fileId = crypto.randomUUID()
      const objectKey = storageKey(admin.tenantId, 'payment_qr', fileId, 'main')
      await putAll(bucket, [{ key: objectKey, upload: main }])
      try {
        const response = await dependencies.repository.recordPaymentQr(
          admin.userId,
          admin.tenantId,
          accountId,
          {
            fileId,
            mimeType: main.mime,
            sizeBytes: main.bytes.length,
            sha256: main.sha256,
            originalFilename: main.filename,
          },
          {
            idempotencyKey: key,
            requestHash: await dependencies.requestHash({ accountId, main: main.sha256 }),
            requestId: context.get('requestId'),
          },
          context.env,
        )
        if (response.fileId !== fileId) await bucket.delete(objectKey)
        return context.json(response, 201)
      } catch (error) {
        await bucket.delete(objectKey).catch(() => undefined)
        throw error
      }
    } catch (error) {
      const response = mapError(context, error)
      if (response) return response
      throw error
    }
  })

  app.post('/v1/catalog/products/:productId/images/order', async (context) => {
    const admin = await dependencies.resolveBackofficeTenant(context)
    if (!admin) return fail(context, 403, 'FILE_ACCESS_DENIED', 'Sign in and select a business to arrange photos.')
    const productId = context.req.param('productId')
    const parsed = productImageOrderRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!uuidPattern.test(productId) || !parsed.success)
      return fail(context, 400, 'INVALID_FILE', 'List every photo once, primary first.')
    try {
      return context.json(
        await dependencies.repository.reorderProductImages(
          admin.userId,
          admin.tenantId,
          productId,
          parsed.data.fileIds,
          context.get('requestId'),
          context.env,
        ),
      )
    } catch (error) {
      const response = mapError(context, error)
      if (response) return response
      throw error
    }
  })

  app.post('/v1/catalog/products/:productId/images/:fileId/archive', async (context) => {
    const admin = await dependencies.resolveBackofficeTenant(context)
    if (!admin) return fail(context, 403, 'FILE_ACCESS_DENIED', 'Sign in and select a business to remove photos.')
    const productId = context.req.param('productId')
    const fileId = context.req.param('fileId')
    if (!uuidPattern.test(productId) || !uuidPattern.test(fileId))
      return fail(context, 400, 'INVALID_FILE', 'Choose a photo to remove.')
    try {
      return context.json(
        await dependencies.repository.archiveProductImage(
          admin.userId,
          admin.tenantId,
          productId,
          fileId,
          context.get('requestId'),
          context.env,
        ),
      )
    } catch (error) {
      const response = mapError(context, error)
      if (response) return response
      throw error
    }
  })

  // Payment proofs (Reseller Portal) ----------------------------------------

  app.post('/v1/portal/orders/:orderId/payment-proofs', async (context) => {
    const token = readBearerToken(context.req.header('authorization'))
    const user = token ? await dependencies.verifyAccessToken(token, context.env) : null
    if (!user) return fail(context, 401, 'AUTHENTICATION_REQUIRED', 'Sign in to the reseller portal.')
    const tenantId = context.req.header('x-tenant-id')
    const orderId = context.req.param('orderId')
    const key = context.req.header('idempotency-key')
    if (!tenantId || !uuidPattern.test(tenantId) || !uuidPattern.test(orderId) || !key || !idempotencyPattern.test(key))
      return fail(context, 400, 'INVALID_FILE', 'Choose the order and provide a valid Idempotency-Key.')
    const bucket = storage(context)
    if (!bucket) return fail(context, 503, 'FILES_NOT_CONFIGURED', 'File storage is not configured.')
    const form = await readForm(context)
    if (form === 'too_large') return partProblem(context, 'too_large', 'upload', UPLOAD_REQUEST_MAX_BYTES)
    if (form === 'invalid') return fail(context, 400, 'INVALID_FILE', 'Send the proof as multipart form data.')
    const fields = paymentProofFieldsSchema.safeParse({
      method: form.method,
      amountMinor: form.amountMinor,
      reference: form.reference,
    })
    if (!fields.success)
      return fail(context, 400, 'INVALID_PAYMENT_PROOF', 'Enter the amount paid and the reference number.')
    const main = await readPart(form.file, PAYMENT_PROOF_MAX_BYTES, [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ])
    if (typeof main === 'string') return partProblem(context, main, 'payment proof', PAYMENT_PROOF_MAX_BYTES)
    let thumb: Upload | null = null
    if (main.mime !== 'application/pdf' && form.thumb !== undefined) {
      const result = await readPart(form.thumb, THUMB_MAX_BYTES, ['image/jpeg', 'image/png', 'image/webp'])
      if (typeof result === 'string') return partProblem(context, result, 'thumbnail', THUMB_MAX_BYTES)
      thumb = result
    }

    try {
      await dependencies.repository.assertPaymentProofUpload(user.userId, tenantId, orderId, context.env)
      const fileId = crypto.randomUUID()
      const mainKey = storageKey(tenantId, 'payment_proof', fileId, 'main')
      const thumbKey = storageKey(tenantId, 'payment_proof', fileId, 'thumb')
      const keys = thumb ? [mainKey, thumbKey] : [mainKey]
      await putAll(bucket, [{ key: mainKey, upload: main }, ...(thumb ? [{ key: thumbKey, upload: thumb }] : [])])
      try {
        const response = await dependencies.repository.recordPaymentProof(
          user.userId,
          tenantId,
          orderId,
          {
            fileId,
            mimeType: main.mime,
            sizeBytes: main.bytes.length,
            ...(thumb ? { thumbSizeBytes: thumb.bytes.length } : {}),
            sha256: main.sha256,
            originalFilename: main.filename,
            ...fields.data,
          },
          {
            idempotencyKey: key,
            requestHash: await dependencies.requestHash({ orderId, file: main.sha256, ...fields.data }),
            requestId: context.get('requestId'),
          },
          context.env,
        )
        // A replayed request answers with the first proof; the bytes just written are not needed.
        if (response.fileId !== fileId) await bucket.delete(keys)
        return context.json(response, 201)
      } catch (error) {
        await bucket.delete(keys).catch(() => undefined)
        throw error
      }
    } catch (error) {
      const response = mapError(context, error)
      if (response) return response
      throw error
    }
  })

  // Back Office review ------------------------------------------------------

  app.get('/v1/reseller-portal/payment-proofs', async (context) => {
    const admin = await dependencies.resolveBackofficeTenant(context)
    if (!admin)
      return fail(
        context,
        403,
        'RESELLER_PORTAL_ADMIN_DENIED',
        'Sign in and select a business to review payment proofs.',
      )
    if (!context.env.FILES_URL_SECRET)
      return fail(context, 503, 'FILES_NOT_CONFIGURED', 'File storage is not configured.')
    try {
      const signer = createFileUrlSigner(context.env.FILES_URL_SECRET)
      const now = nowSeconds(dependencies)
      const stored = await dependencies.repository.listPendingProofs(admin.userId, admin.tenantId, context.env)
      const proofs = await Promise.all(
        stored.map(async ({ storageKey: key, thumbStorageKey, ...proof }) => ({
          ...proof,
          url: await signer.sign(key, paymentProofExpiry(now)),
          thumbUrl: thumbStorageKey ? await signer.sign(thumbStorageKey, paymentProofExpiry(now)) : null,
        })),
      )
      return context.json(pendingPaymentProofsSchema.parse({ proofs }))
    } catch (error) {
      const response = mapError(context, error)
      if (response) return response
      throw error
    }
  })

  app.post('/v1/reseller-portal/payment-proofs/:proofId/review', async (context) => {
    const admin = await dependencies.resolveBackofficeTenant(context)
    if (!admin)
      return fail(
        context,
        403,
        'RESELLER_PORTAL_ADMIN_DENIED',
        'Sign in and select a business to review payment proofs.',
      )
    const proofId = context.req.param('proofId')
    const parsed = paymentProofReviewRequestSchema.safeParse(await context.req.json().catch(() => null))
    if (!uuidPattern.test(proofId) || !parsed.success)
      return fail(context, 400, 'INVALID_PAYMENT_PROOF_REVIEW', 'Accept the proof, or reject it with a reason.')
    try {
      return context.json(
        await dependencies.repository.reviewPaymentProof(
          admin.userId,
          admin.tenantId,
          proofId,
          parsed.data,
          context.get('requestId'),
          context.env,
        ),
      )
    } catch (error) {
      const response = mapError(context, error)
      if (response) return response
      throw error
    }
  })
}

/** Signs a payment QR key with the product-photo expiry window so links stay cacheable. */
export async function signFileKey(key: string, bindings: Bindings, now: number): Promise<string | null> {
  if (!bindings.FILES_URL_SECRET) return null
  return createFileUrlSigner(bindings.FILES_URL_SECRET).sign(key, productImageExpiry(now))
}
