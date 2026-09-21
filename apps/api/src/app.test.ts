import { apiErrorResponseSchema, healthResponseSchema, sessionContextResponseSchema } from '@hcs/contracts'
import { describe, expect, it } from 'vitest'

import { app, createApp } from './app'

const bindings = { ENVIRONMENT: 'test' }
const userId = '10000000-0000-4000-8000-000000000001'
const tenantId = '20000000-0000-4000-8000-000000000001'
const locationId = '30000000-0000-4000-8000-000000000001'

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
})

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
})
