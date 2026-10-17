import type { TenantAccess } from '@hcs/contracts'

export function resolveSetupLanding(tenant: TenantAccess | null, recoveringPassword: boolean): string | null {
  if (recoveringPassword || !tenant || tenant.isOwner) return null
  if (tenant.permissions.includes('reports.read')) return '/reports'
  if (
    tenant.entitlements.includes('advanced_wholesale') &&
    tenant.permissions.some((permission) => ['wholesale_orders.read', 'wholesale_orders.manage'].includes(permission))
  ) {
    return '/wholesale'
  }
  return '/'
}
