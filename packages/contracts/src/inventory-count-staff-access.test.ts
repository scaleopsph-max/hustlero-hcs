import { expect, it } from 'vitest'
import { inventoryCountStaffAccessSchema } from './inventory-count'

const employeeId = '10000000-0000-4000-8000-000000000001'
const locationId = '20000000-0000-4000-8000-000000000001'

it('accepts explicit grant and revoke for one employee and one branch', () => {
  expect(inventoryCountStaffAccessSchema.parse({ employeeId, locationId, enabled: true }).enabled).toBe(true)
  expect(inventoryCountStaffAccessSchema.parse({ employeeId, locationId, enabled: false }).enabled).toBe(false)
})
it('rejects client-supplied authority, tenant, and malformed assignments', () => {
  expect(
    inventoryCountStaffAccessSchema.safeParse({ employeeId, locationId, enabled: true, tenantId: locationId }).success,
  ).toBe(false)
  expect(
    inventoryCountStaffAccessSchema.safeParse({ employeeId, locationId, enabled: true, isOwner: true }).success,
  ).toBe(false)
  expect(inventoryCountStaffAccessSchema.safeParse({ employeeId, locationId: 'all', enabled: true }).success).toBe(
    false,
  )
  expect(inventoryCountStaffAccessSchema.safeParse({ employeeId, locationId, enabled: 'true' }).success).toBe(false)
})
