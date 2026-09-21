export type ActorType = 'tenant_user' | 'pos_employee' | 'platform_admin'

export interface RequestContext {
  readonly requestId: string
  readonly actorType: ActorType
  readonly userId: string
  readonly tenantId: string
  readonly employeeId?: string
  readonly locationIds: readonly string[]
  readonly activeLocationId?: string
  readonly deviceId?: string
  readonly permissions: ReadonlySet<string>
  readonly entitlements: ReadonlySet<string>
}

export function canUseCapability(context: RequestContext, capability: string): boolean {
  return context.permissions.has(capability) && context.entitlements.has(capability)
}
