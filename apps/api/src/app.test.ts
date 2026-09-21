import { healthResponseSchema } from '@hcs/contracts'
import { describe, expect, it } from 'vitest'

import { app } from './app'

const bindings = { ENVIRONMENT: 'test' }

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
})
