import type { TenantAccess } from '@hcs/contracts'

const activeTenantStorageKey = 'hcs:backoffice:active-tenant'

export function selectActiveTenant(tenants: TenantAccess[]): TenantAccess | undefined {
  if (typeof window !== 'undefined') {
    const storedTenantId = window.localStorage.getItem(activeTenantStorageKey)
    const storedTenant = tenants.find((tenant) => tenant.tenantId === storedTenantId)
    if (storedTenant) return storedTenant
  }

  return tenants.find((tenant) => tenant.isOwner) ?? tenants[0]
}

export function saveActiveTenant(tenantId: string): void {
  window.localStorage.setItem(activeTenantStorageKey, tenantId)
}
