import { describe, expect, it, vi } from 'vitest'

import { createApp } from './app'
import {
  createFileUrlSigner,
  detectMime,
  paymentProofExpiry,
  productImageExpiry,
  signProductImages,
  storageKey,
  verifyFileUrl,
  type FileBucket,
} from './files'
import type { FilesRepository } from './files-repository'

const ownerId = '10000000-0000-4000-8000-000000000001'
const resellerId = '10000000-0000-4000-8000-000000000099'
const tenantId = '20000000-0000-4000-8000-000000000001'
const productId = '30000000-0000-4000-8000-000000000001'
const orderId = '60000000-0000-4000-8000-000000000001'
const secret = 'test-only-file-link-secret'
const now = 1_793_000_000
const bindings = { ENVIRONMENT: 'test', FILES_URL_SECRET: secret }

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9])
const pdf = new TextEncoder().encode('%PDF-1.7 receipt')
const html = new TextEncoder().encode('<html><script>alert(1)</script>')

function memoryBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>()
  const bucket: FileBucket = {
    put: vi.fn(async (key, value, options) => {
      objects.set(key, {
        bytes: new Uint8Array(value as ArrayBuffer),
        ...(options?.httpMetadata?.contentType ? { contentType: options.httpMetadata.contentType } : {}),
      })
    }),
    get: vi.fn(async (key) => {
      const object = objects.get(key)
      return object
        ? {
            body: new Blob([object.bytes as Uint8Array<ArrayBuffer>]).stream(),
            httpMetadata: object.contentType ? { contentType: object.contentType } : {},
          }
        : null
    }),
    delete: vi.fn(async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key)
    }),
  }
  return { bucket, objects }
}

function repository(overrides: Partial<FilesRepository> = {}): FilesRepository {
  return {
    assertProductImageUpload: vi.fn(async () => undefined),
    recordProductImage: vi.fn(async (_user, _tenant, product, file) => ({
      fileId: file.fileId,
      productId: product,
      position: 0,
      status: 'uploaded' as const,
    })),
    reorderProductImages: vi.fn(),
    archiveProductImage: vi.fn(),
    listImagesForMember: vi.fn(async () => []),
    listImagesForPos: vi.fn(async () => []),
    listImagesForReseller: vi.fn(async () => []),
    assertPaymentProofUpload: vi.fn(async () => undefined),
    recordPaymentProof: vi.fn(async (_user, _tenant, order, file) => ({
      proofId: '70000000-0000-4000-8000-000000000001',
      fileId: file.fileId,
      salesOrderId: order,
      status: 'pending' as const,
      amountMinor: file.amountMinor,
      method: file.method,
    })),
    listPendingProofs: vi.fn(async () => []),
    reviewPaymentProof: vi.fn(),
    ...overrides,
  } as FilesRepository
}

function filesApp(files: FilesRepository, bucket: FileBucket | null) {
  return createApp({
    verifyAccessToken: async (token) =>
      token === 'owner' ? { userId: ownerId } : token === 'reseller' ? { userId: resellerId } : null,
    loadSessionAccess: async (userId) =>
      userId === ownerId
        ? [
            {
              tenantId,
              tenantSlug: 'store',
              tenantName: 'Store',
              isOwner: true,
              employeeId: null,
              locationIds: [],
              locationCount: 1,
              permissions: [],
              entitlements: [],
            },
          ]
        : [],
    files,
    fileBucket: () => bucket,
  })
}

function form(parts: Record<string, Blob | string>) {
  const body = new FormData()
  for (const [name, value] of Object.entries(parts)) {
    if (typeof value === 'string') body.append(name, value)
    else body.append(name, value, `${name}.bin`)
  }
  return body
}

describe('file helpers', () => {
  it('detects the real type from file bytes', () => {
    expect(detectMime(jpeg)).toBe('image/jpeg')
    expect(detectMime(png)).toBe('image/png')
    expect(detectMime(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
    expect(detectMime(pdf)).toBe('application/pdf')
    expect(detectMime(html)).toBeNull()
  })

  it('signs links for every stored kind, including portal logos', async () => {
    for (const kind of ['product_image', 'payment_proof', 'payment_qr', 'brand_logo', 'return_photo'] as const) {
      const key = storageKey(tenantId, kind, '40000000-0000-4000-8000-000000000001', 'main')
      const url = new URL(await createFileUrlSigner(secret).sign(key, now + 600), 'https://api.example.test')
      const read = (name: string) => url.searchParams.get(name) ?? undefined
      expect(await verifyFileUrl(secret, read('key'), read('exp'), read('sig'), now)).toBe(key)
    }
  })

  it('signs links that expire and cannot be retargeted', async () => {
    const key = storageKey(tenantId, 'product_image', '40000000-0000-4000-8000-000000000001', 'thumb')
    const path = await createFileUrlSigner(secret).sign(key, now + 600)
    const url = new URL(path, 'https://api.example.test')
    const read = (name: string) => url.searchParams.get(name) ?? undefined
    expect(await verifyFileUrl(secret, read('key'), read('exp'), read('sig'), now)).toBe(key)
    expect(await verifyFileUrl(secret, read('key'), read('exp'), read('sig'), now + 601)).toBeNull()
    expect(await verifyFileUrl('another-secret', read('key'), read('exp'), read('sig'), now)).toBeNull()
    const otherKey = storageKey(
      '20000000-0000-4000-8000-000000000002',
      'product_image',
      '40000000-0000-4000-8000-000000000001',
      'thumb',
    )
    expect(await verifyFileUrl(secret, otherKey, read('exp'), read('sig'), now)).toBeNull()
    expect(await verifyFileUrl(secret, '../../etc/passwd', read('exp'), read('sig'), now)).toBeNull()
  })

  it('keeps photo links stable within a window and proof links short', () => {
    expect(productImageExpiry(now)).toBe(productImageExpiry(now + 60))
    expect(productImageExpiry(now) - now).toBeGreaterThan(18 * 3600)
    expect(paymentProofExpiry(now) - now).toBeLessThanOrEqual(15 * 60)
  })

  it('groups photos by product in display order', async () => {
    const signer = createFileUrlSigner(secret)
    const grouped = await signProductImages(
      [
        { productId, fileId: 'b', position: 1, storageKey: 'k-b', thumbStorageKey: 't-b', variantIds: [] },
        { productId, fileId: 'a', position: 0, storageKey: 'k-a', thumbStorageKey: 't-a', variantIds: [] },
      ],
      signer,
      now,
    )
    expect(grouped.get(productId)?.map((image) => image.fileId)).toEqual(['a', 'b'])
  })
})

describe('file routes', () => {
  it('stores a product photo and its thumbnail under derived keys', async () => {
    const { bucket, objects } = memoryBucket()
    const files = repository()
    const response = await filesApp(files, bucket).request(
      `/v1/catalog/products/${productId}/images`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer owner', 'x-tenant-id': tenantId, 'idempotency-key': 'photo-upload-0001' },
        body: form({ image: new Blob([jpeg]), thumb: new Blob([jpeg]) }),
      },
      bindings,
    )
    expect(response.status).toBe(201)
    const { fileId } = (await response.json()) as { fileId: string }
    expect([...objects.keys()].sort()).toEqual([
      storageKey(tenantId, 'product_image', fileId, 'main'),
      storageKey(tenantId, 'product_image', fileId, 'thumb'),
    ])
    expect(files.assertProductImageUpload).toHaveBeenCalledWith(ownerId, tenantId, productId, bindings)
    expect(files.recordProductImage).toHaveBeenCalledWith(
      ownerId,
      tenantId,
      productId,
      expect.objectContaining({ fileId, mimeType: 'image/jpeg', sizeBytes: jpeg.length, thumbSizeBytes: jpeg.length }),
      expect.objectContaining({ idempotencyKey: 'photo-upload-0001' }),
      bindings,
    )
  })

  it('rejects files whose bytes are not an allowed image, whatever their name says', async () => {
    const { bucket, objects } = memoryBucket()
    const response = await filesApp(repository(), bucket).request(
      `/v1/catalog/products/${productId}/images`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer owner', 'x-tenant-id': tenantId, 'idempotency-key': 'photo-upload-0002' },
        body: form({ image: new Blob([html], { type: 'image/jpeg' }), thumb: new Blob([jpeg]) }),
      },
      bindings,
    )
    expect(response.status).toBe(415)
    expect(objects.size).toBe(0)
  })

  it('stores nothing when the database refuses the upload', async () => {
    const { bucket, objects } = memoryBucket()
    const files = repository({
      assertProductImageUpload: vi.fn(async () => Promise.reject(Object.assign(new Error('limit'), { code: 'HCFL4' }))),
    })
    const response = await filesApp(files, bucket).request(
      `/v1/catalog/products/${productId}/images`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer owner', 'x-tenant-id': tenantId, 'idempotency-key': 'photo-upload-0003' },
        body: form({ image: new Blob([jpeg]), thumb: new Blob([jpeg]) }),
      },
      bindings,
    )
    expect(response.status).toBe(409)
    expect(objects.size).toBe(0)
  })

  it('removes the new bytes when a retry replays the first upload', async () => {
    const { bucket, objects } = memoryBucket()
    const files = repository({
      recordProductImage: vi.fn(async () => ({
        fileId: '40000000-0000-4000-8000-0000000000aa',
        productId,
        position: 0,
        status: 'uploaded' as const,
      })),
    })
    const response = await filesApp(files, bucket).request(
      `/v1/catalog/products/${productId}/images`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer owner', 'x-tenant-id': tenantId, 'idempotency-key': 'photo-upload-0004' },
        body: form({ image: new Blob([jpeg]), thumb: new Blob([jpeg]) }),
      },
      bindings,
    )
    expect(response.status).toBe(201)
    expect(objects.size).toBe(0)
  })

  it('accepts a reseller payment proof PDF with amount and reference', async () => {
    const { bucket, objects } = memoryBucket()
    const files = repository()
    const response = await filesApp(files, bucket).request(
      `/v1/portal/orders/${orderId}/payment-proofs`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer reseller', 'x-tenant-id': tenantId, 'idempotency-key': 'proof-upload-00001' },
        body: form({
          file: new Blob([pdf]),
          method: 'bank_transfer',
          amountMinor: '350000',
          reference: 'BDO-2026-10-29-001',
        }),
      },
      bindings,
    )
    expect(response.status).toBe(201)
    expect(objects.size).toBe(1)
    expect(files.recordPaymentProof).toHaveBeenCalledWith(
      resellerId,
      tenantId,
      orderId,
      expect.objectContaining({
        mimeType: 'application/pdf',
        amountMinor: 350000,
        reference: 'BDO-2026-10-29-001',
        method: 'bank_transfer',
      }),
      expect.objectContaining({ idempotencyKey: 'proof-upload-00001' }),
      bindings,
    )
  })

  it('requires the amount and reference on a proof', async () => {
    const { bucket } = memoryBucket()
    const response = await filesApp(repository(), bucket).request(
      `/v1/portal/orders/${orderId}/payment-proofs`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer reseller', 'x-tenant-id': tenantId, 'idempotency-key': 'proof-upload-00002' },
        body: form({ file: new Blob([png]), method: 'gcash', amountMinor: '0', reference: '1' }),
      },
      bindings,
    )
    expect(response.status).toBe(400)
  })

  it('serves stored bytes only through a valid signed link', async () => {
    const { bucket } = memoryBucket()
    const key = storageKey(tenantId, 'product_image', '40000000-0000-4000-8000-000000000001', 'thumb')
    await bucket.put(key, jpeg, { httpMetadata: { contentType: 'image/jpeg' } })
    const app = filesApp(repository(), bucket)
    const path = await createFileUrlSigner(secret).sign(key, Math.floor(Date.now() / 1000) + 600)
    const served = await app.request(path, {}, bindings)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/jpeg')
    expect(served.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(jpeg)
    const tampered = await app.request(path.replace('thumb', 'main'), {}, bindings)
    expect(tampered.status).toBe(404)
  })

  it('reports missing storage configuration instead of failing silently', async () => {
    const response = await filesApp(repository(), null).request(
      `/v1/catalog/products/${productId}/images`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer owner', 'x-tenant-id': tenantId, 'idempotency-key': 'photo-upload-0005' },
        body: form({ image: new Blob([jpeg]), thumb: new Blob([jpeg]) }),
      },
      bindings,
    )
    expect(response.status).toBe(503)
  })

  it('adds signed photo URLs to the Back Office catalog and keeps it loading if photos fail', async () => {
    const catalog = {
      categories: [],
      products: [
        {
          id: productId,
          name: 'Coffee',
          description: null,
          status: 'active' as const,
          category: null,
          variants: [
            {
              id: '50000000-0000-4000-8000-000000000001',
              name: '250g',
              sku: 'C-250',
              retailPriceMinor: 30000,
              unitCostMinor: null,
              trackInventory: true,
              isActive: true,
              barcodes: [],
            },
          ],
        },
      ],
    }
    const withPhotos = createApp({
      verifyAccessToken: async () => ({ userId: ownerId }),
      loadSessionAccess: async () => [
        {
          tenantId,
          tenantSlug: 'store',
          tenantName: 'Store',
          isOwner: true,
          employeeId: null,
          locationIds: [],
          locationCount: 1,
          permissions: [],
          entitlements: [],
        },
      ],
      loadCatalog: async () => catalog,
      files: repository({
        listImagesForMember: vi.fn(async () => [
          {
            productId,
            fileId: '40000000-0000-4000-8000-000000000001',
            position: 0,
            storageKey: storageKey(tenantId, 'product_image', '40000000-0000-4000-8000-000000000001', 'main'),
            thumbStorageKey: storageKey(tenantId, 'product_image', '40000000-0000-4000-8000-000000000001', 'thumb'),
            variantIds: [],
          },
        ]),
      }),
    })
    const response = await withPhotos.request(
      '/v1/catalog',
      { headers: { authorization: 'Bearer owner', 'x-tenant-id': tenantId } },
      bindings,
    )
    const body = (await response.json()) as { products: { images: { url: string }[] }[] }
    expect(body.products[0]?.images[0]?.url).toMatch(/^\/v1\/files\/content\?key=/)

    const failing = createApp({
      verifyAccessToken: async () => ({ userId: ownerId }),
      loadSessionAccess: async () => [
        {
          tenantId,
          tenantSlug: 'store',
          tenantName: 'Store',
          isOwner: true,
          employeeId: null,
          locationIds: [],
          locationCount: 1,
          permissions: [],
          entitlements: [],
        },
      ],
      loadCatalog: async () => catalog,
      files: repository({ listImagesForMember: vi.fn(async () => Promise.reject(new Error('database unavailable'))) }),
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fallback = await failing.request(
      '/v1/catalog',
      { headers: { authorization: 'Bearer owner', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(fallback.status).toBe(200)
    warn.mockRestore()
  })
})

describe('POS photos', () => {
  it('maps each POS item to its product photo thumbnail through the variant', async () => {
    const { decoratePosContext } = await import('./files-routes')
    const variantId = '50000000-0000-4000-8000-000000000001'
    const fileId = '40000000-0000-4000-8000-000000000001'
    const context = {
      items: [
        { variantId, productName: 'Coffee' },
        { variantId: '50000000-0000-4000-8000-000000000002', productName: 'Tea' },
      ],
    } as unknown as Parameters<typeof decoratePosContext>[1]
    const decorated = await decoratePosContext(
      repository({
        listImagesForPos: vi.fn(async () => [
          {
            productId,
            fileId,
            position: 0,
            storageKey: storageKey(tenantId, 'product_image', fileId, 'main'),
            thumbStorageKey: storageKey(tenantId, 'product_image', fileId, 'thumb'),
            variantIds: [variantId],
          },
        ]),
      }),
      context,
      'a'.repeat(64),
      bindings,
      now,
    )
    expect(decorated.items[0]?.imageThumbUrl).toContain(encodeURIComponent('/thumb'))
    expect(decorated.items[1]?.imageThumbUrl).toBeNull()
  })
})
