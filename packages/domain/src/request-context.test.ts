import { describe, expect, it } from 'vitest'

import { canUseCapability, type RequestContext } from './request-context'

const baseContext: RequestContext = {
  requestId: 'request-1',
  actorType: 'tenant_user',
  userId: 'user-1',
  tenantId: 'tenant-1',
  locationIds: ['location-1'],
  permissions: new Set(['inventory.read']),
  entitlements: new Set(['inventory.read']),
}

describe('canUseCapability', () => {
  it('requires both permission and entitlement', () => {
    expect(canUseCapability(baseContext, 'inventory.read')).toBe(true)
    expect(canUseCapability(baseContext, 'inventory.adjust')).toBe(false)
  })
})
