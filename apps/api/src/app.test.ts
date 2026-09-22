import {
  apiErrorResponseSchema,
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
const countActiveLocations = vi.fn(async () => 1)

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
  countActiveLocations,
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
      countActiveLocations,
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
      countActiveLocations,
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
})
