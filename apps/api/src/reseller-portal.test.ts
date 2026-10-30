import {
  apiErrorResponseSchema,
  resellerOrderSubmitResponseSchema,
  resellerPortalCatalogSchema,
  type ResellerOrderSubmitRequest,
  type ResellerPortalAdmin,
  type ResellerPortalCatalog,
} from '@hcs/contracts'
import { describe, expect, it, vi } from 'vitest'

import { createApp } from './app'
import type { ResellerPortalRepository } from './reseller-portal-repository'

const ownerId = '10000000-0000-4000-8000-000000000001'
const resellerUserId = '10000000-0000-4000-8000-000000000099'
const tenantId = '20000000-0000-4000-8000-000000000001'
const otherTenantId = '20000000-0000-4000-8000-000000000002'
const variantId = '50000000-0000-4000-8000-000000000001'
const orderId = '60000000-0000-4000-8000-000000000001'
const applicationId = '70000000-0000-4000-8000-000000000001'
const bindings = { ENVIRONMENT: 'test', RESELLER_ORIGIN: 'https://reseller.example.test' }

const catalog: ResellerPortalCatalog = {
  account: {
    accountId: '80000000-0000-4000-8000-000000000001',
    customerId: '90000000-0000-4000-8000-000000000001',
    customerName: 'Maria Santos',
    businessName: 'Sample Store',
    priceListName: 'Reseller price',
    pricingType: 'wholesale',
    paymentTerm: 'prepaid',
    creditLimitMinor: 2_000_000,
    availableCreditMinor: 1_750_000,
    pointsBalance: 0,
  },
  fulfillmentLocationName: 'Main Warehouse',
  items: [
    {
      variantId,
      productId: '51000000-0000-4000-8000-000000000001',
      productName: 'Coffee Beans',
      variantName: '250g',
      sku: 'COF-250',
      categoryName: null,
      unitPriceMinor: 25_000,
      srpMinor: 35_000,
      pricingGroupId: '52000000-0000-4000-8000-000000000001',
      pricingGroupName: 'Reseller group',
      thresholdMilli: 2_000,
      stockStatus: 'in_stock',
    },
  ],
}

const adminContext: ResellerPortalAdmin = {
  tenantSlug: 'sample-store',
  settings: null,
  locations: [],
  priceLists: [],
  resellerCustomers: [],
  applications: [],
  accounts: [],
  reviewQueue: [],
}

function postgresError(code: string) {
  return Object.assign(new Error(code), { code })
}

function repository(overrides: Partial<ResellerPortalRepository> = {}): ResellerPortalRepository {
  return {
    loadPublic: vi.fn(async (slug) => ({
      tenantSlug: slug,
      businessName: 'Sample Store',
      configured: true,
      applicationsOpen: true,
    })),
    submitApplication: vi.fn(async () => ({ status: 'received' as const })),
    loadSession: vi.fn(async () => ({ accounts: [] })),
    loadCatalog: vi.fn(async (_user, tenant) => {
      if (tenant !== tenantId) throw postgresError('HCRP1')
      return catalog
    }),
    listOrders: vi.fn(async () => ({ orders: [] })),
    submitOrder: vi.fn(async () => ({
      salesOrderId: orderId,
      orderNumber: 'RP-000001',
      status: 'confirmed' as const,
      reviewReason: null,
      lineCount: 1,
      totalMinor: 250_000,
    })),
    loadAdmin: vi.fn(async () => adminContext),
    saveSettings: vi.fn(),
    decideApplication: vi.fn(async () => ({ status: 'rejected' as const, applicationId })),
    inviteAccount: vi.fn(),
    setAccountStatus: vi.fn(),
    reviewOrder: vi.fn(async () => ({ salesOrderId: orderId, status: 'cancelled' as const })),
    ...overrides,
  } as ResellerPortalRepository
}

function portalApp(resellerPortal: ResellerPortalRepository) {
  return createApp({
    verifyAccessToken: async (token) =>
      token === 'owner-token' ? { userId: ownerId } : token === 'reseller-token' ? { userId: resellerUserId } : null,
    loadSessionAccess: async (userId) =>
      userId === ownerId
        ? [
            {
              tenantId,
              tenantSlug: 'sample-store',
              tenantName: 'Sample Store',
              isOwner: true,
              employeeId: null,
              locationIds: [],
              locationCount: 1,
              permissions: [],
              entitlements: ['advanced_wholesale', 'reseller_portal'],
            },
          ]
        : [],
    resellerPortal,
  })
}

const orderRequest: ResellerOrderSubmitRequest = {
  lines: [{ variantId, quantityMilli: 10_000 }],
  fulfillmentMethod: 'delivery',
  deliveryAddress: 'Blk 4 Lot 2, Tagaytay City',
  paymentPreference: 'gcash',
}

describe('reseller portal API', () => {
  it('serves the public application form without sign-in and validates input', async () => {
    const repo = repository()
    const app = portalApp(repo)

    const info = await app.request('/v1/public/reseller-portal/sample-store', {}, bindings)
    expect(info.status).toBe(200)
    expect(await info.json()).toMatchObject({ businessName: 'Sample Store', applicationsOpen: true })

    const invalid = await app.request(
      '/v1/public/reseller-portal/sample-store/applications',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fullName: 'M', email: 'bad' }),
      },
      bindings,
    )
    expect(invalid.status).toBe(400)
    expect(repo.submitApplication).not.toHaveBeenCalled()

    const received = await app.request(
      '/v1/public/reseller-portal/sample-store/applications',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fullName: 'Maria Santos', email: 'maria@example.test', phone: '0917-123-4567' }),
      },
      bindings,
    )
    expect(received.status).toBe(202)
    expect(repo.submitApplication).toHaveBeenCalledWith(
      'sample-store',
      { fullName: 'Maria Santos', email: 'maria@example.test', phone: '09171234567' },
      expect.any(String),
      bindings,
    )

    const badSlug = await app.request('/v1/public/reseller-portal/..%2Fadmin', {}, bindings)
    expect(badSlug.status).toBe(404)
  })

  it('maps closed applications to a clear error', async () => {
    const app = portalApp(repository({ submitApplication: vi.fn(async () => Promise.reject(postgresError('HCRP6'))) }))
    const response = await app.request(
      '/v1/public/reseller-portal/sample-store/applications',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fullName: 'Maria Santos', email: 'maria@example.test', phone: '09171234567' }),
      },
      bindings,
    )
    expect(response.status).toBe(409)
    expect(apiErrorResponseSchema.parse(await response.json()).error.code).toBe('RESELLER_APPLICATIONS_CLOSED')
  })

  it('requires a verified reseller token and a selected business', async () => {
    const repo = repository()
    const app = portalApp(repo)

    const anonymous = await app.request('/v1/portal/catalog', { headers: { 'x-tenant-id': tenantId } }, bindings)
    expect(anonymous.status).toBe(401)

    const noTenant = await app.request(
      '/v1/portal/catalog',
      { headers: { authorization: 'Bearer reseller-token' } },
      bindings,
    )
    expect(noTenant.status).toBe(400)

    const loaded = await app.request(
      '/v1/portal/catalog',
      { headers: { authorization: 'Bearer reseller-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(loaded.status).toBe(200)
    expect(resellerPortalCatalogSchema.safeParse(await loaded.json()).success).toBe(true)
    expect(repo.loadCatalog).toHaveBeenCalledWith(resellerUserId, tenantId, bindings)

    const otherTenant = await app.request(
      '/v1/portal/catalog',
      { headers: { authorization: 'Bearer reseller-token', 'x-tenant-id': otherTenantId } },
      bindings,
    )
    expect(otherTenant.status).toBe(403)
    expect(apiErrorResponseSchema.parse(await otherTenant.json()).error.code).toBe('RESELLER_ACCESS_DENIED')
  })

  it('submits portal orders with an idempotency key and a request hash', async () => {
    const repo = repository()
    const app = portalApp(repo)
    const headers = {
      authorization: 'Bearer reseller-token',
      'content-type': 'application/json',
      'x-tenant-id': tenantId,
    }

    const missingKey = await app.request(
      '/v1/portal/orders',
      { method: 'POST', headers, body: JSON.stringify(orderRequest) },
      bindings,
    )
    expect(missingKey.status).toBe(400)

    const missingAddress = await app.request(
      '/v1/portal/orders',
      {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': 'portal-order-0001' },
        body: JSON.stringify({ ...orderRequest, deliveryAddress: undefined }),
      },
      bindings,
    )
    expect(missingAddress.status).toBe(400)

    const duplicateLines = await app.request(
      '/v1/portal/orders',
      {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': 'portal-order-0001' },
        body: JSON.stringify({ ...orderRequest, lines: [orderRequest.lines[0], orderRequest.lines[0]] }),
      },
      bindings,
    )
    expect(duplicateLines.status).toBe(400)
    expect(repo.submitOrder).not.toHaveBeenCalled()

    const submitted = await app.request(
      '/v1/portal/orders',
      {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': 'portal-order-0001' },
        body: JSON.stringify(orderRequest),
      },
      bindings,
    )
    expect(submitted.status).toBe(201)
    expect(resellerOrderSubmitResponseSchema.parse(await submitted.json()).status).toBe('confirmed')
    expect(repo.submitOrder).toHaveBeenCalledWith(
      resellerUserId,
      tenantId,
      orderRequest,
      {
        idempotencyKey: 'portal-order-0001',
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        requestId: expect.any(String),
      },
      bindings,
    )
  })

  it('reports the wholesale minimum to the reseller', async () => {
    const app = portalApp(repository({ submitOrder: vi.fn(async () => Promise.reject(postgresError('HCRP5'))) }))
    const response = await app.request(
      '/v1/portal/orders',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer reseller-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'portal-order-0002',
        },
        body: JSON.stringify(orderRequest),
      },
      bindings,
    )
    expect(response.status).toBe(409)
    expect(apiErrorResponseSchema.parse(await response.json()).error.code).toBe('RESELLER_MINIMUM_NOT_MET')
  })

  it('refuses orders with out-of-stock items', async () => {
    const app = portalApp(repository({ submitOrder: vi.fn(async () => Promise.reject(postgresError('HCRP7'))) }))
    const response = await app.request(
      '/v1/portal/orders',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer reseller-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'portal-order-0003',
        },
        body: JSON.stringify(orderRequest),
      },
      bindings,
    )
    expect(response.status).toBe(409)
    expect(apiErrorResponseSchema.parse(await response.json()).error.code).toBe('RESELLER_ITEM_OUT_OF_STOCK')
  })

  it('keeps Back Office administration behind a member session', async () => {
    const repo = repository()
    const app = portalApp(repo)

    const reseller = await app.request(
      '/v1/reseller-portal/admin',
      { headers: { authorization: 'Bearer reseller-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(reseller.status).toBe(403)
    expect(repo.loadAdmin).not.toHaveBeenCalled()

    const owner = await app.request(
      '/v1/reseller-portal/admin',
      { headers: { authorization: 'Bearer owner-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(owner.status).toBe(200)
    expect(repo.loadAdmin).toHaveBeenCalledWith(ownerId, tenantId, bindings)
  })

  it('reviews held orders and decides applications with validated decisions', async () => {
    const repo = repository()
    const app = portalApp(repo)
    const headers = {
      authorization: 'Bearer owner-token',
      'content-type': 'application/json',
      'x-tenant-id': tenantId,
      'idempotency-key': 'portal-review-0001',
    }

    const noReason = await app.request(
      `/v1/reseller-portal/orders/${orderId}/review`,
      { method: 'POST', headers, body: JSON.stringify({ decision: 'reject' }) },
      bindings,
    )
    expect(noReason.status).toBe(400)

    const rejected = await app.request(
      `/v1/reseller-portal/orders/${orderId}/review`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ decision: 'reject', reason: 'Settle the open balance first' }),
      },
      bindings,
    )
    expect(rejected.status).toBe(200)
    expect(repo.reviewOrder).toHaveBeenCalledWith(
      ownerId,
      tenantId,
      orderId,
      { decision: 'reject', reason: 'Settle the open balance first' },
      expect.objectContaining({ idempotencyKey: 'portal-review-0001' }),
      bindings,
    )

    const longKey = await app.request(
      `/v1/reseller-portal/applications/${applicationId}/decision`,
      {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': 'k'.repeat(125) },
        body: JSON.stringify({ decision: 'reject', reason: 'Incomplete details' }),
      },
      bindings,
    )
    expect(longKey.status).toBe(400)

    const decided = await app.request(
      `/v1/reseller-portal/applications/${applicationId}/decision`,
      { method: 'POST', headers, body: JSON.stringify({ decision: 'reject', reason: 'Incomplete details' }) },
      bindings,
    )
    expect(decided.status).toBe(200)
  })

  it('allows the reseller portal origin through CORS', async () => {
    const app = portalApp(repository())
    const response = await app.request(
      '/v1/portal/session',
      {
        method: 'OPTIONS',
        headers: { origin: 'https://reseller.example.test', 'access-control-request-method': 'GET' },
      },
      bindings,
    )
    expect(response.headers.get('access-control-allow-origin')).toBe('https://reseller.example.test')
  })
})
