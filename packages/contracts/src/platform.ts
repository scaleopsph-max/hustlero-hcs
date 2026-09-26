import { z } from 'zod'

const id = z.uuid()
const timestamp = z.iso.datetime({ offset: true })

export const platformAdminRoleSchema = z.enum(['super_admin', 'operations', 'support'])
export const tenantStatusSchema = z.enum(['active', 'suspended'])

export const platformEntitlementSchema = z.object({
  featureCode: z.string().min(1),
  featureName: z.string().min(1),
  platformAvailable: z.boolean(),
  entitled: z.boolean(),
  enabled: z.boolean(),
  startsAt: timestamp.nullable(),
  endsAt: timestamp.nullable(),
})

export const platformContextSchema = z.object({
  admin: z.object({
    userId: id,
    displayName: z.string().min(1),
    role: platformAdminRoleSchema,
    canManage: z.boolean(),
  }),
  metrics: z.object({
    tenantCount: z.number().int().nonnegative(),
    activeTenantCount: z.number().int().nonnegative(),
    suspendedTenantCount: z.number().int().nonnegative(),
    availableFeatureCount: z.number().int().nonnegative(),
  }),
  features: z.array(z.object({ code: z.string().min(1), name: z.string().min(1), platformAvailable: z.boolean() })),
  tenants: z.array(
    z.object({
      id,
      slug: z.string().min(1),
      name: z.string().min(1),
      status: tenantStatusSchema,
      baseCurrency: z.string().length(3),
      timezone: z.string().min(1),
      createdAt: timestamp,
      locationCount: z.number().int().nonnegative(),
      memberCount: z.number().int().nonnegative(),
      entitlements: z.array(platformEntitlementSchema),
    }),
  ),
})

export const platformEntitlementUpdateRequestSchema = z.object({
  entitled: z.boolean(),
  endsAt: timestamp.nullable().default(null),
  reason: z.string().trim().min(3).max(240),
})
export const platformEntitlementUpdateResponseSchema = z.object({
  tenantId: id,
  featureCode: z.string().min(1),
  entitled: z.boolean(),
  enabled: z.boolean(),
  startsAt: timestamp.nullable(),
  endsAt: timestamp.nullable(),
})
export const platformTenantStatusUpdateRequestSchema = z.object({
  status: tenantStatusSchema,
  reason: z.string().trim().min(3).max(240),
})
export const platformTenantStatusUpdateResponseSchema = z.object({ tenantId: id, status: tenantStatusSchema })

export const supportAccessGrantSchema = z.object({
  id,
  tenantId: id,
  tenantName: z.string().min(1),
  adminUserId: id,
  ticketReference: z.string().min(3).max(120),
  reason: z.string().min(3).max(240),
  accessLevel: z.literal('read_only'),
  scope: z.array(z.literal('tenant_overview')).min(1),
  startsAt: timestamp,
  expiresAt: timestamp,
  revokedAt: timestamp.nullable(),
  revocationReason: z.string().min(3).max(240).nullable(),
  createdAt: timestamp,
})

export const supportAccessContextSchema = z.object({
  canGrant: z.boolean(),
  grants: z.array(supportAccessGrantSchema),
})

export const supportAccessCreateRequestSchema = z.object({
  tenantId: id,
  ticketReference: z.string().trim().min(3).max(120),
  reason: z.string().trim().min(3).max(240),
  durationMinutes: z.number().int().min(15).max(120),
})

export const supportAccessRevokeRequestSchema = z.object({ reason: z.string().trim().min(3).max(240) })

export const supportAccessOverviewSchema = z.object({
  access: supportAccessGrantSchema,
  tenant: z.object({
    id,
    slug: z.string().min(1),
    name: z.string().min(1),
    status: tenantStatusSchema,
    baseCurrency: z.string().length(3),
    timezone: z.string().min(1),
  }),
  metrics: z.object({
    locationCount: z.number().int().nonnegative(),
    activeMemberCount: z.number().int().nonnegative(),
    activeEmployeeCount: z.number().int().nonnegative(),
    activeProductCount: z.number().int().nonnegative(),
    activeVariantCount: z.number().int().nonnegative(),
    inventoryPositionCount: z.number().int().nonnegative(),
    registerCount: z.number().int().nonnegative(),
    openRegisterSessionCount: z.number().int().nonnegative(),
    completedSaleCount: z.number().int().nonnegative(),
  }),
  locations: z.array(
    z.object({ id, code: z.string().min(1), name: z.string().min(1), kind: z.string().min(1), isActive: z.boolean() }),
  ),
})

export type PlatformContext = z.infer<typeof platformContextSchema>
export type PlatformEntitlementUpdateRequest = z.infer<typeof platformEntitlementUpdateRequestSchema>
export type PlatformEntitlementUpdateResponse = z.infer<typeof platformEntitlementUpdateResponseSchema>
export type PlatformTenantStatusUpdateRequest = z.infer<typeof platformTenantStatusUpdateRequestSchema>
export type PlatformTenantStatusUpdateResponse = z.infer<typeof platformTenantStatusUpdateResponseSchema>
export type SupportAccessGrant = z.infer<typeof supportAccessGrantSchema>
export type SupportAccessContext = z.infer<typeof supportAccessContextSchema>
export type SupportAccessCreateRequest = z.infer<typeof supportAccessCreateRequestSchema>
export type SupportAccessRevokeRequest = z.infer<typeof supportAccessRevokeRequestSchema>
export type SupportAccessOverview = z.infer<typeof supportAccessOverviewSchema>
