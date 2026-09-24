import {
  approvalCenterSchema,
  approvalDecisionResponseSchema,
  approvalPolicyUpdateResponseSchema,
  apiErrorResponseSchema,
  catalogProductCreateResponseSchema,
  catalogProductUpdateResponseSchema,
  catalogResponseSchema,
  catalogVariantCreateResponseSchema,
  catalogVariantDeactivateResponseSchema,
  catalogVariantUpdateResponseSchema,
  healthResponseSchema,
  inventoryAdjustmentCreateResponseSchema,
  inventoryMovementContextSchema,
  inventoryStockContextSchema,
  openingInventoryContextSchema,
  openingInventoryCreateResponseSchema,
  purchaseOrderCreateResponseSchema,
  purchaseReceiptResponseSchema,
  purchasingContextSchema,
  supplierCreateResponseSchema,
  transferContextSchema,
  transferCreateResponseSchema,
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
  hasOpeningInventory: false,
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
const updateCatalogVariant = vi.fn(async () => ({
  productId: '40000000-0000-4000-8000-000000000001',
  variantId: '50000000-0000-4000-8000-000000000002',
  status: 'updated' as const,
}))
const deactivateCatalogVariant = vi.fn(async () => ({
  productId: '40000000-0000-4000-8000-000000000001',
  variantId: '50000000-0000-4000-8000-000000000002',
  status: 'deactivated' as const,
}))
const loadOpeningInventory = vi.fn(async () => ({
  locations: [{ id: locationId, code: 'MAIN', name: 'Main Store' }],
  selectedLocationId: locationId,
  items: [
    {
      productId: '40000000-0000-4000-8000-000000000001',
      productName: 'Triple Black',
      variantId: '50000000-0000-4000-8000-000000000001',
      variantName: 'Small',
      sku: 'TSH-BLK-S',
      defaultUnitCostMinor: 55_000,
      openingUnitCostMinor: null,
      openingQuantityMilli: 0,
      onHandMilli: 0,
      opened: false,
    },
  ],
}))
const recordOpeningInventory = vi.fn(async () => ({
  locationId,
  movementCount: 1,
  status: 'recorded' as const,
}))
const loadInventoryStock = vi.fn(async () => ({
  locations: [{ id: locationId, code: 'MAIN', name: 'Main Store' }],
  selectedLocationId: locationId,
  items: [
    {
      productId: '40000000-0000-4000-8000-000000000001',
      productName: 'Triple Black',
      variantId: '50000000-0000-4000-8000-000000000001',
      variantName: 'Small',
      sku: 'TSH-BLK-S',
      barcodeCount: 1,
      onHandMilli: 12_500,
      reservedMilli: 500,
      availableMilli: 12_000,
      inTransitMilli: 0,
      damagedMilli: 0,
      averageUnitCostMinor: 55_000,
      hasBalance: true,
    },
  ],
}))
const loadInventoryMovements = vi.fn(async () => ({
  locationId,
  items: [
    {
      id: '60000000-0000-4000-8000-000000000001',
      productId: '40000000-0000-4000-8000-000000000001',
      productName: 'Triple Black',
      variantId: '50000000-0000-4000-8000-000000000001',
      variantName: 'Small',
      sku: 'TSH-BLK-S',
      movementType: 'OPENING_BALANCE' as const,
      quantityMilli: 12_500,
      unitCostMinor: 55_000,
      sourceType: 'onboarding_opening_inventory',
      sourceReference: 'opening-inventory-001',
      actorLabel: 'Business owner',
      occurredAt: '2026-09-24T10:00:00.000Z',
      balanceAfterMilli: 12_500,
    },
  ],
}))
const recordInventoryAdjustment = vi.fn(async () => ({
  movementId: '60000000-0000-4000-8000-000000000001',
  locationId,
  variantId: '50000000-0000-4000-8000-000000000001',
  quantityMilli: -500,
  onHandMilli: 11_500,
  status: 'recorded' as const,
}))
const loadApprovalCenter = vi.fn(async () => ({
  canManage: false,
  inventoryAdjustmentThresholdMilli: 10_000,
  requests: [
    {
      id: '70000000-0000-4000-8000-000000000001',
      subjectType: 'inventory_adjustment' as const,
      status: 'pending' as const,
      locationId,
      locationName: 'Main Store',
      variantId: '50000000-0000-4000-8000-000000000001',
      productName: 'Triple Black',
      variantName: 'Small',
      sku: 'TSH-BLK-S',
      quantityMilli: -12_000,
      unitCostMinor: null,
      reason: 'Cycle count correction',
      requestedByLabel: 'Business owner',
      requestedAt: '2026-09-24T10:00:00.000Z',
      decidedByLabel: null,
      decidedAt: null,
      decisionNote: null,
    },
  ],
}))
const updateApprovalPolicy = vi.fn(async (_userId, _tenantId, request) => ({
  inventoryAdjustmentThresholdMilli: request.inventoryAdjustmentThresholdMilli,
  status: 'updated' as const,
}))
const decideApprovalRequest = vi.fn(async (_userId, _tenantId, approvalRequestId, request) => ({
  approvalRequestId,
  movementId: request.decision === 'approved' ? '60000000-0000-4000-8000-000000000002' : null,
  status: request.decision,
}))
const loadPurchasing = vi.fn(async () => ({ suppliers: [], locations: [], variants: [], orders: [] }))
const createSupplier = vi.fn(async () => ({
  supplierId: '80000000-0000-4000-8000-000000000001',
  status: 'created' as const,
}))
const createPurchaseOrder = vi.fn(async () => ({
  purchaseOrderId: '90000000-0000-4000-8000-000000000001',
  status: 'draft' as const,
  lineCount: 1,
}))
const sendPurchaseOrder = vi.fn(async (_userId, _tenantId, purchaseOrderId) => ({
  purchaseOrderId,
  status: 'ordered' as const,
}))
const receivePurchaseOrder = vi.fn(async (_userId, _tenantId, purchaseOrderId) => ({
  purchaseReceiptId: 'a0000000-0000-4000-8000-000000000001',
  purchaseOrderId,
  status: 'received' as const,
  lineCount: 1,
}))
const loadTransfers = vi.fn(async () => ({ locations: [], variants: [], transfers: [] }))
const createTransfer = vi.fn(async () => ({
  stockTransferId: 'b0000000-0000-4000-8000-000000000001',
  status: 'draft' as const,
  itemCount: 1,
}))
const dispatchTransfer = vi.fn(async (_userId, _tenantId, id) => ({
  stockTransferId: id,
  status: 'dispatched' as const,
}))
const receiveTransfer = vi.fn(async (_userId, _tenantId, id) => ({
  stockTransferId: id,
  status: 'received' as const,
  itemCount: 1,
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
  updateCatalogVariant,
  deactivateCatalogVariant,
  loadInventoryStock,
  loadInventoryMovements,
  recordInventoryAdjustment,
  loadOpeningInventory,
  recordOpeningInventory,
  loadApprovalCenter,
  updateApprovalPolicy,
  decideApprovalRequest,
  loadPurchasing,
  createSupplier,
  createPurchaseOrder,
  sendPurchaseOrder,
  receivePurchaseOrder,
  loadTransfers,
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
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
      updateCatalogVariant,
      deactivateCatalogVariant,
      loadInventoryStock,
      loadInventoryMovements,
      recordInventoryAdjustment,
      loadOpeningInventory,
      recordOpeningInventory,
      loadApprovalCenter,
      updateApprovalPolicy,
      decideApprovalRequest,
      loadPurchasing,
      createSupplier,
      createPurchaseOrder,
      sendPurchaseOrder,
      receivePurchaseOrder,
      loadTransfers,
      createTransfer,
      dispatchTransfer,
      receiveTransfer,
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
      updateCatalogVariant,
      deactivateCatalogVariant,
      loadInventoryStock,
      loadInventoryMovements,
      recordInventoryAdjustment,
      loadOpeningInventory,
      recordOpeningInventory,
      loadApprovalCenter,
      updateApprovalPolicy,
      decideApprovalRequest,
      loadPurchasing,
      createSupplier,
      createPurchaseOrder,
      sendPurchaseOrder,
      receivePurchaseOrder,
      loadTransfers,
      createTransfer,
      dispatchTransfer,
      receiveTransfer,
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

  it('updates a variant using server identity and integer minor-unit money', async () => {
    updateCatalogVariant.mockClear()
    const request = {
      variantName: 'Black / Medium',
      sku: 'TSH-BLK-M',
      retailPriceMinor: 89_900,
      unitCostMinor: 55_000,
      trackInventory: true,
      barcodes: ['480000000088'],
    }
    const response = await authenticatedApp.request(
      '/v1/catalog/products/40000000-0000-4000-8000-000000000001/variants/50000000-0000-4000-8000-000000000002',
      {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'catalog-variant-update-001',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(catalogVariantUpdateResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(updateCatalogVariant).toHaveBeenCalledWith(
      userId,
      tenantId,
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002',
      request,
      'catalog-variant-update-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('deactivates a variant without accepting tenant identity from the body', async () => {
    deactivateCatalogVariant.mockClear()
    const response = await authenticatedApp.request(
      '/v1/catalog/products/40000000-0000-4000-8000-000000000001/variants/50000000-0000-4000-8000-000000000002',
      {
        method: 'DELETE',
        headers: {
          authorization: 'Bearer valid-token',
          'x-tenant-id': tenantId,
          'idempotency-key': 'catalog-variant-delete-001',
        },
      },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(catalogVariantDeactivateResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(deactivateCatalogVariant).toHaveBeenCalledWith(
      userId,
      tenantId,
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002',
      'catalog-variant-delete-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('returns a conflict when deactivation would remove the last active variant', async () => {
    deactivateCatalogVariant.mockRejectedValueOnce(Object.assign(new Error('last variant'), { code: 'HCS13' }))
    const response = await authenticatedApp.request(
      '/v1/catalog/products/40000000-0000-4000-8000-000000000001/variants/50000000-0000-4000-8000-000000000002',
      {
        method: 'DELETE',
        headers: {
          authorization: 'Bearer valid-token',
          'x-tenant-id': tenantId,
          'idempotency-key': 'catalog-variant-delete-last',
        },
      },
      bindings,
    )
    expect(response.status).toBe(409)
    expect(apiErrorResponseSchema.parse(await response.json()).error.code).toBe('LAST_ACTIVE_VARIANT')
  })

  it('loads live stock for the server-resolved tenant and requested location', async () => {
    loadInventoryStock.mockClear()
    const response = await authenticatedApp.request(
      `/v1/inventory/stock?locationId=${locationId}`,
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(inventoryStockContextSchema.safeParse(await response.json()).success).toBe(true)
    expect(loadInventoryStock).toHaveBeenCalledWith(userId, tenantId, locationId, bindings)
  })

  it('loads the approval center for the server-resolved tenant', async () => {
    loadApprovalCenter.mockClear()
    const response = await authenticatedApp.request(
      '/v1/approvals',
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(approvalCenterSchema.parse(await response.json()).canManage).toBe(true)
    expect(loadApprovalCenter).toHaveBeenCalledWith(userId, tenantId, bindings)
  })

  it('updates the inventory adjustment approval threshold', async () => {
    updateApprovalPolicy.mockClear()
    const request = { inventoryAdjustmentThresholdMilli: 25_000 }
    const response = await authenticatedApp.request(
      '/v1/approvals/policy',
      {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'approval-policy-001',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(approvalPolicyUpdateResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(updateApprovalPolicy).toHaveBeenCalledWith(
      userId,
      tenantId,
      request,
      'approval-policy-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('approves a pending request through an idempotent decision command', async () => {
    decideApprovalRequest.mockClear()
    const approvalRequestId = '70000000-0000-4000-8000-000000000001'
    const request = { decision: 'approved', note: null }
    const response = await authenticatedApp.request(
      `/v1/approvals/${approvalRequestId}/decision`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'approval-decision-001',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(approvalDecisionResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(decideApprovalRequest).toHaveBeenCalledWith(
      userId,
      tenantId,
      approvalRequestId,
      request,
      'approval-decision-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('loads movement history with server-validated filters', async () => {
    loadInventoryMovements.mockClear()
    const variantId = '50000000-0000-4000-8000-000000000001'
    const response = await authenticatedApp.request(
      `/v1/inventory/movements?locationId=${locationId}&variantId=${variantId}&limit=50`,
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(inventoryMovementContextSchema.safeParse(await response.json()).success).toBe(true)
    expect(loadInventoryMovements).toHaveBeenCalledWith(userId, tenantId, locationId, variantId, 50, bindings)
  })

  it('rejects movement requests without a valid location', async () => {
    loadInventoryMovements.mockClear()
    const response = await authenticatedApp.request(
      '/v1/inventory/movements?locationId=not-a-location',
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(400)
    expect(loadInventoryMovements).not.toHaveBeenCalled()
  })

  it('records an inventory adjustment with a reason and integer units', async () => {
    recordInventoryAdjustment.mockClear()
    const request = {
      locationId,
      variantId: '50000000-0000-4000-8000-000000000001',
      quantityMilli: -500,
      unitCostMinor: null,
      reason: 'Damaged during receiving',
    }
    const response = await authenticatedApp.request(
      '/v1/inventory/adjustments',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'inventory-adjustment-001',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(201)
    expect(inventoryAdjustmentCreateResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(recordInventoryAdjustment).toHaveBeenCalledWith(
      userId,
      tenantId,
      request,
      'inventory-adjustment-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('rejects an adjustment without a non-zero quantity or reason', async () => {
    recordInventoryAdjustment.mockClear()
    const response = await authenticatedApp.request(
      '/v1/inventory/adjustments',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'inventory-adjustment-002',
        },
        body: JSON.stringify({
          locationId,
          variantId: '50000000-0000-4000-8000-000000000001',
          quantityMilli: 0,
          reason: '',
        }),
      },
      bindings,
    )
    expect(response.status).toBe(400)
    expect(recordInventoryAdjustment).not.toHaveBeenCalled()
  })

  it('loads opening inventory for the server-resolved tenant and requested location', async () => {
    loadOpeningInventory.mockClear()
    const response = await authenticatedApp.request(
      `/v1/inventory/opening-balances?locationId=${locationId}`,
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(openingInventoryContextSchema.safeParse(await response.json()).success).toBe(true)
    expect(loadOpeningInventory).toHaveBeenCalledWith(userId, tenantId, locationId, bindings)
  })

  it('records opening inventory using integer quantity and money units', async () => {
    recordOpeningInventory.mockClear()
    const request = {
      locationId,
      entries: [
        {
          variantId: '50000000-0000-4000-8000-000000000001',
          quantityMilli: 12_000,
          unitCostMinor: 55_000,
        },
      ],
    }
    const response = await authenticatedApp.request(
      '/v1/inventory/opening-balances',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'opening-inventory-001',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(201)
    expect(openingInventoryCreateResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(recordOpeningInventory).toHaveBeenCalledWith(
      userId,
      tenantId,
      request,
      'opening-inventory-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })

  it('rejects empty opening inventory before reaching the database', async () => {
    recordOpeningInventory.mockClear()
    const response = await authenticatedApp.request(
      '/v1/inventory/opening-balances',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'opening-inventory-empty',
        },
        body: JSON.stringify({ locationId, entries: [] }),
      },
      bindings,
    )
    expect(response.status).toBe(400)
    expect(recordOpeningInventory).not.toHaveBeenCalled()
  })

  it('loads purchasing context for the server-resolved tenant', async () => {
    loadPurchasing.mockClear()
    const response = await authenticatedApp.request(
      '/v1/purchasing',
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(purchasingContextSchema.safeParse(await response.json()).success).toBe(true)
    expect(loadPurchasing).toHaveBeenCalledWith(userId, tenantId, bindings)
  })

  it('creates supplier and purchase order with idempotency headers', async () => {
    createSupplier.mockClear()
    createPurchaseOrder.mockClear()
    const supplier = await authenticatedApp.request(
      '/v1/purchasing/suppliers',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'supplier-create-001',
        },
        body: JSON.stringify({ name: 'Acme Wholesale', contactName: null, contactPhone: null, contactEmail: null }),
      },
      bindings,
    )
    expect(supplier.status).toBe(201)
    expect(supplierCreateResponseSchema.safeParse(await supplier.json()).success).toBe(true)
    const orderRequest = {
      supplierId: '80000000-0000-4000-8000-000000000001',
      locationId,
      orderNumber: 'PO-0001',
      expectedAt: null,
      notes: null,
      lines: [{ variantId: '50000000-0000-4000-8000-000000000001', quantityMilli: 2_000, unitCostMinor: 55_000 }],
    }
    const order = await authenticatedApp.request(
      '/v1/purchasing/orders',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'purchase-order-create-001',
        },
        body: JSON.stringify(orderRequest),
      },
      bindings,
    )
    expect(order.status).toBe(201)
    expect(purchaseOrderCreateResponseSchema.safeParse(await order.json()).success).toBe(true)
  })

  it('rejects purchase receipt payloads without positive lines', async () => {
    receivePurchaseOrder.mockClear()
    const response = await authenticatedApp.request(
      '/v1/purchasing/orders/90000000-0000-4000-8000-000000000001/receive',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'purchase-receipt-empty',
        },
        body: JSON.stringify({ lines: [], deliveryReference: null }),
      },
      bindings,
    )
    expect(response.status).toBe(400)
    expect(receivePurchaseOrder).not.toHaveBeenCalled()
    expect(purchaseReceiptResponseSchema.safeParse(await response.json()).success).toBe(false)
  })

  it('loads transfer context for the server-resolved tenant', async () => {
    loadTransfers.mockClear()
    const response = await authenticatedApp.request(
      '/v1/transfers',
      { headers: { authorization: 'Bearer valid-token', 'x-tenant-id': tenantId } },
      bindings,
    )
    expect(response.status).toBe(200)
    expect(transferContextSchema.safeParse(await response.json()).success).toBe(true)
    expect(loadTransfers).toHaveBeenCalledWith(userId, tenantId, bindings)
  })

  it('creates a draft transfer with integer quantity units', async () => {
    createTransfer.mockClear()
    const request = {
      transferNumber: 'TR-0001',
      sourceLocationId: locationId,
      destinationLocationId: '30000000-0000-4000-8000-000000000002',
      items: [{ variantId: '50000000-0000-4000-8000-000000000001', quantityMilli: 2_000 }],
    }
    const response = await authenticatedApp.request(
      '/v1/transfers',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'idempotency-key': 'transfer-create-001',
        },
        body: JSON.stringify(request),
      },
      bindings,
    )
    expect(response.status).toBe(201)
    expect(transferCreateResponseSchema.safeParse(await response.json()).success).toBe(true)
    expect(createTransfer).toHaveBeenCalledWith(
      userId,
      tenantId,
      request,
      'transfer-create-001',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.any(String),
      bindings,
    )
  })
})
