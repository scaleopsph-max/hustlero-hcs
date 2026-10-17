import { describe, expect, it } from 'vitest'
import type { TenantAccess } from '@hcs/contracts'
import { resolveSetupLanding } from './setup-landing'

const member: TenantAccess = {
  tenantId: '20000000-0000-4000-8000-000000000001',
  tenantSlug: 'synthetic',
  tenantName: 'Synthetic Business',
  isOwner: false,
  employeeId: null,
  locationIds: [],
  locationCount: 1,
  permissions: ['reports.read', 'wholesale_orders.read'],
  entitlements: ['advanced_wholesale'],
}

describe('setup landing', () => {
  it('opens reports for a read-only member without changing its permissions', () => {
    expect(resolveSetupLanding(member, false)).toBe('/reports')
    expect(member.isOwner).toBe(false)
    expect(member.permissions).toEqual(['reports.read', 'wholesale_orders.read'])
  })

  it('keeps owners and accounts without an active membership in setup', () => {
    expect(resolveSetupLanding({ ...member, isOwner: true }, false)).toBeNull()
    expect(resolveSetupLanding(null, false)).toBeNull()
  })

  it('never redirects password recovery even for an existing member', () => {
    expect(resolveSetupLanding(member, true)).toBeNull()
    expect(resolveSetupLanding({ ...member, isOwner: true }, true)).toBeNull()
  })

  it('opens wholesale only with its entitlement and read or manage permission', () => {
    expect(resolveSetupLanding({ ...member, permissions: ['wholesale_orders.read'] }, false)).toBe('/wholesale')
    expect(resolveSetupLanding({ ...member, permissions: ['wholesale_orders.manage'] }, false)).toBe('/wholesale')
    expect(resolveSetupLanding({ ...member, permissions: ['wholesale_orders.read'], entitlements: [] }, false)).toBe(
      '/',
    )
    expect(resolveSetupLanding({ ...member, permissions: [] }, false)).toBe('/')
  })
})
