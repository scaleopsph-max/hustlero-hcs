import {
  apiErrorResponseSchema,
  catalogProductCreateResponseSchema,
  catalogProductUpdateResponseSchema,
  catalogResponseSchema,
  catalogVariantCreateResponseSchema,
  healthResponseSchema,
  onboardingResponseSchema,
  sessionContextResponseSchema,
} from '@hcs/contracts'
import { describe, expect, it, vi } from 'vitest'

import { app, createApp } from './app'

const bindings = { ENVIRONMENT: 'test' }
const userId = '10000000-0000-4000-8000-000000000001'
const tenantId = '20000000-0000-4000-8000-000000000001'
const locationId = '30000000-0000-4000-8000-000000000001'
const bootstrapTenant = vi.fn(async () => ({ tenantId, mainLocationId: locationId, status: 'setup' as const }))
const featureOptions = [
  { code: 'catalog' as const, name: 'Products and catalog', enabled: true, required: true },
  { code: 'sales' as const, name: 'Sales and checkout', enabled: true, required: true },
  { code: 'reports' as const, name: 'Basic reports', enabled: true, required: true },
  { code: 'inventory' as const, name: 'Inventory tracking', enabled: false, required: false },
]
const loadOnboarding = vi.fn(async () => ({
  hasMainLocation: true,
  hasProducts: false,
  businessQuestionsComplete: false,
  featureSelectionComplete: false,
  businessProfile: null,
  featureOptions,
}))
const updateOnboarding = vi.fn(async (_userId, _tenantId, request) => ({
  step: request.step,
  status: 'complete' as const,
  ...(request.step === 'feature_selection' ? { enabledFeatures: request.enabledFeatures } : {}),
}))
const loadCatalog = vi.fn(async () => ({ categories: [], products: [] }))
const createCatalogProduct = vi.fn(async () => ({
  productId: '40000000-0000-4000-8000-000000000001',
  variantId: '50000000-0000-4000-8000-000000000001',
  status: 'created' as const,
}))
const createCatalogVariant = vi.fn(async () => ({
  productId: '40000000-0000-4000-8000-000000000001',
  variantId: '50000000-0000-4000-8000-000000000002',
  status: 'created' as const,
}))
const updateCatalogProduct = vi.fn(async () => ({
  productId: '40000000-0000-4000-8000-000000000001',
  status: 'updated' as const,
}))

const authenticatedApp = createApp({
  verifyAccessToken: async (token) => (token === 'valid-token' ? { userId } : null),
  loadSessionAccess: async (requestedUserId) => {
    expect(requestedUserId).toBe(userId)

    return [
      {
        tenantId,
        tenantSlug: 'sample-store',
        tenantName: 'Sample Store',
        isOwner: true,
        employeeId: null,
        locationIds: [locationId],
        permissions: ['inventory.read'],
        entitlements: ['inventory'],
      },
    ]
  },
  bootstrapTenant,
  loadOnboarding,
  updateOnboarding,
  loadCatalog,
  createCatalogProduct,
  createCatalogVariant,
  updateCatalogProduct,
})

const businessDetails = {
  name: 'Sample Store',
  slug: 'sample-store',
  mainLocation: { code: 'MAIN', name: 'Main Store' },
}

function postBusiness(body: unknown, key = 'onboarding-request-001') {
  return authenticatedApp.request(
    '/v1/tenants',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-token',
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(body),
    },
    bindings,
  )
}

describe('API', () => {
  it('returns a contract-valid health response', async () => {
    const response = await app.request('/health', {}, bindings)
    const payload: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(healthResponseSchema.safeParse(payload).success).toBe(true)
  })

  it('uses the standard error envelope for unknown routes', async () => {
    const response = await app.request('/missing', {}, bindings)
    const payload = await response.json<{ error: { code: string; requestId: string } }>()

    expect(response.status).toBe(404)
    expect(payload.error.code).toBe('NOT_FOUND')
    expect(payload.error.requestId).toBeTruthy()
  })

  it('rejects a missing bearer token without querying tenant access', async () => {
    const response = await authenticatedApp.request('/v1/me', {}, bindings)
    const payload: unknown = await response.json()

    expect(response.status).toBe(401)
    expect(apiErrorResponseSchema.parse(payload).error.code).toBe('AUTHENTICATION_REQUIRED')
  })

  it('rejects a malformed authorization header', async () => {
    const response = await authenticatedApp.request(
      '/v1/me',
      { headers: { authorization: 'Basic not-a-bearer-token' } },
      bindings,
    )
    const payload: unknown = await response.json()

    expect(response.status).toBe(401)
    expect(apiErrorResponseSchema.parse(payload).error.code).toBe('AUTHENTICATION_REQUIRED')
  })

  it('rejects an invalid bearer token', async () => {
    const response = await authenticatedApp.request(
      '/v1/me',
      { headers: { authorization: 'Bearer invalid-token' } },
      bindings,
    )
    const payload: unknown = await response.json()

    expect(response.status).toBe(401)
    expect(apiErrorResponseSchema.parse(payload).error.code).toBe('INVALID_ACCESS_TOKEN')
  })

  it('returns only server-resolved tenant and branch access', async () => {
    const response = await authenticatedApp.request(
      '/v1/me',
      {
        headers: {
          authorization: 'Bearer valid-token',
          'x-tenant-id': 'client-supplied-value-is-ignored',
        },
      },
      bindings,
    )
    const payload: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(sessionContextResponseSchema.parse(payload)).toEqual({
      userId,
      tenants: [
        {
          tenantId,
          tenantSlug: 'sample-store',
          tenantName: 'Sample Store',
          isOwner: true,
          employeeId: null,
          locationIds: [locationId],
          permissions: ['inventory.read'],
          entitlements: ['inventory'],
        },
      ],
    })
  })

  it('requires authentication and a valid idempotency key before business creation', async () => {
    const unauthenticated = await authenticatedApp.request('/v1/tenants', { method: 'POST' }, bindings)
    expect(unauthenticated.status).toBe(401)

    const missingKey = await authenticatedApp.request(
      '/v1/tenants',
      {
        method: 'POST',
        headers: { authorization: 'Bearer valid-token' },
      },
      bindings,
    )
    expect(apiErrorResponseSchema.parse(await missingKey.json()).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
  })

  it('validates business input and calls the atomic bootstrap command with server identity', async () => {
    bootstrapTenant.mockClear()
    expect((await postBusiness({ ...businessDetails, slug: 'Bad Slug' })).status).toBe(400)
    expect(bootstrapTenant).not.toHaveBeenCalled()

    const response = await postBusiness(businessDetails)
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ tenantId, mainLocationId: locationId })
    expect(bootstrapTenant).toHaveBeenCalledWith(
      userId,
      { ...businessDetails, baseCurrency: 'PHP', timezone: 'Asia/Manila' },
      'onboarding-request-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('resolves setup status only for an owned tenant', async () => {
    const response = await authenticatedApp.request(
      '/v1/onboarding',
      {
        headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId },
      },
      bindings,
    )
    expect(response.status).toBe(200)
    const payload = onboardingResponseSchema.parse(await response.json())
    expect(payload.readyToSell).toBe(false)
    expect(payload.steps[0]).toEqual({ code: 'business', status: 'complete' })
    expect(payload.steps[1]).toEqual({ code: 'main_location', status: 'complete' })
    expect(payload.steps.at(-1)).toEqual({ code: 'test_sale', status: 'pending' })

    const foreignTenant = await authenticatedApp.request(
      '/v1/onboarding',
      {
        headers: { authorization: 'Bearer valid-token', 'x-tenant-id': 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
      },
      bindings,
    )
    expect(foreignTenant.status).toBe(403)
    expect(apiErrorResponseSchema.parse(await foreignTenant.json()).error.code).toBe('ONBOARDING_ACCESS_DENIED')
  })

  it('requires explicit tenant selection for multi-business owners', async () => {
    const multiTenantApp = createApp({
      verifyAccessToken: async () => ({ userId }),
      loadSessionAccess: async () => [
        {
          tenantId,
          tenantSlug: 'first',
          tenantName: 'First',
          isOwner: true,
          employeeId: null,
          locationIds: [],
          permissions: [],
          entitlements: [],
        },
        {
          tenantId: '20000000-0000-4000-8000-000000000002',
          tenantSlug: 'second',
          tenantName: 'Second',
          isOwner: true,
          employeeId: null,
          locationIds: [],
          permissions: [],
          entitlements: [],
        },
      ],
      bootstrapTenant,
      loadOnboarding,
      updateOnboarding,
      loadCatalog,
      createCatalogProduct,
      createCatalogVariant,
      updateCatalogProduct,
    })
    const response = await multiTenantApp.request(
      '/v1/onboarding',
      {
        headers: { authorization: 'Bearer valid-token' },
      },
      bindings,
    )
    expect(response.status).toBe(409)
    expect(apiErrorResponseSchema.parse(await response.json()).error.code).toBe('TENANT_SELECTION_REQUIRED')
  })

  it('does not allow non-owners to view owner setup', async () => {
    const employeeApp = createApp({
      verifyAccessToken: async () => ({ userId }),
      loadSessionAccess: async () => [
        {
          tenantId,
          tenantSlug: 'sample-store',
          tenantName: 'Sample Store',
          isOwner: false,
          employeeId: null,
          locationIds: [],
          permissions: [],
          entitlements: [],
        },
      ],
      bootstrapTenant,
      loadOnboarding,
      updateOnboarding,
      loadCatalog,
      createCatalogProduct,
      createCatalogVariant,
      updateCatalogProduct,
    })
    const response = await employeeApp.request(
      '/v1/onboarding',
      {
        headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId },
      },
      bindings,
    )
    expect(response.status).toBe(403)
    expect(apiErrorResponseSchema.parse(await response.json()).error.code).toBe('ONBOARDING_ACCESS_DENIED')
  })

  it('allows CORS only from the configured Back Office origin', async () => {
    const allowed = await authenticatedApp.request(
      '/v1/me',
      {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:3001', 'access-control-request-method': 'GET' },
      },
      { ...bindings, BACKOFFICE_ORIGIN: 'http://localhost:3001' },
    )
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:3001')

    const denied = await authenticatedApp.request(
      '/v1/me',
      {
        method: 'OPTIONS',
        headers: { origin: 'https://untrusted.example', 'access-control-request-method': 'GET' },
      },
      { ...bindings, BACKOFFICE_ORIGIN: 'http://localhost:3001' },
    )
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('validates and saves business setup questions for the server-resolved owner', async () => {
    updateOnboarding.mockClear()
    const invalid = await authenticatedApp.request(
      '/v1/onboarding',
      {
        method: 'PATCH',
        headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ step: 'business_questions', businessType: 'unknown' }),
      },
      bindings,
    )
    expect(invalid.status).toBe(400)
    expect(updateOnboarding).not.toHaveBeenCalled()

    const request = {
      step: 'business_questions' as const,
      businessType: 'retail' as const,
      salesChannels: ['in_store' as const],
      tracksInventory: true,
      productSetupMethod: 'manual' as const,
    }
    const response = await authenticatedApp.request(
      '/v1/onboarding',
      {
        method: 'PATCH',
        headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(updateOnboarding).toHaveBeenCalledWith(userId, tenantId, request, expect.any(String), bindings)
  })

  it('saves only selectable feature codes', async () => {
    const invalid = await authenticatedApp.request(
      '/v1/onboarding',
      {
        method: 'PATCH',
        headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ step: 'feature_selection', enabledFeatures: ['online_store'] }),
      },
      bindings,
    )
    expect(invalid.status).toBe(400)

    const response = await authenticatedApp.request(
      '/v1/onboarding',
      {
        method: 'PATCH',
        headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ step: 'feature_selection', enabledFeatures: ['inventory', 'customers'] }),
      },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      step: 'feature_selection',
      status: 'complete',
      enabledFeatures: ['inventory', 'customers'],
    })
  })

  it('returns a contract-valid catalog for the server-resolved tenant', async () => {
    loadCatalog.mockClear()
    const response = await authenticatedApp.request(
      '/v1/catalog',
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(catalogResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(loadCatalog).toHaveBeenCalledWith(userId, tenantId, bindings)
  })

  it('requires valid product details and an idempotency key', async () => {
    createCatalogProduct.mockClear()
    const missingKey = await authenticatedApp.request(
      '/v1/catalog/products',
      {
        method: 'POST',
        headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({}),
      },
      bindings,
    )
    expect(apiErrorResponseSchema.parse(await missingKey.json()).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')

    const invalid = await authenticatedApp.request(
      '/v1/catalog/products',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'catalog-request-001',
        },
        body: JSON.stringify({ name: 'Coffee', sku: 'bad sku', retailPriceMinor: 12000 }),
      },
      bindings,
    )
    expect(invalid.status).toBe(400)
    expect(createCatalogProduct).not.toHaveBeenCalled()
  })

  it('creates a product using server identity and integer minor-unit money', async () => {
    createCatalogProduct.mockClear()
    const request = {
      name: 'Iced Coffee',
      description: 'House blend',
      categoryName: 'Drinks',
      variantName: 'Regular',
      sku: 'COF-001',
      retailPriceMinor: 12_050,
      unitCostMinor: 5_525,
      trackInventory: true,
      barcodes: ['480000000001'],
    }
    const response = await authenticatedApp.request(
      '/v1/catalog/products',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'catalog-request-002',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(201)
    expect(catalogProductCreateResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(createCatalogProduct).toHaveBeenCalledWith(
      userId,
      tenantId,
      request,
      'catalog-request-002',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('adds a variant to an existing product using the server-resolved tenant', async () => {
    createCatalogVariant.mockClear()
    const request = {
      variantName: 'Black / XL',
      sku: 'TSH-BLK-XL',
      retailPriceMinor: 99_900,
      unitCostMinor: 65_000,
      trackInventory: true,
      barcodes: ['480000000099'],
    }
    const response = await authenticatedApp.request(
      '/v1/catalog/products/40000000-0000-4000-8000-000000000001/variants',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'catalog-variant-001',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(201)
    expect(catalogVariantCreateResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(createCatalogVariant).toHaveBeenCalledWith(
      userId,
      tenantId,
      '40000000-0000-4000-8000-000000000001',
      request,
      'catalog-variant-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('updates the product master using the server-resolved tenant', async () => {
    updateCatalogProduct.mockClear()
    const request = { name: 'Triple Black', categoryName: 'Shirts', description: 'Core shirt line' }
    const response = await authenticatedApp.request(
      '/v1/catalog/products/40000000-0000-4000-8000-000000000001',
      {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'catalog-product-update-001',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(catalogProductUpdateResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(updateCatalogProduct).toHaveBeenCalledWith(
      userId,
      tenantId,
      '40000000-0000-4000-8000-000000000001',
      request,
      'catalog-product-update-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })
})
