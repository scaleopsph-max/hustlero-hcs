const activeTenantStorageKey = 'hcs:backoffice:active-tenant'

type TenantChoice = { tenantId: string; isOwner: boolean }

export function formatLocationCount({ locationCount }: { locationCount: number }): string {
  return `${locationCount} location${locationCount === 1 ? '' : 's'}`
}

export function selectActiveTenant<T extends TenantChoice>(tenants: T[]): T | undefined {
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
