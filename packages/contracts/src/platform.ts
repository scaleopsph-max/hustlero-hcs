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

export const subscriptionPlanFeatureSchema = z.object({
  featureCode: z.string().min(1),
  featureName: z.string().min(1),
  limitValue: z.number().int().nonnegative().nullable(),
})

export const subscriptionPlanSchema = z.object({
  id,
  code: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['draft', 'active', 'archived']),
  defaultTrialDays: z.number().int().min(0).max(365),
  features: z.array(subscriptionPlanFeatureSchema),
  createdAt: timestamp,
})

export const tenantSubscriptionSchema = z.object({
  id,
  planId: id,
  planName: z.string().min(1),
  status: z.enum(['trialing', 'active', 'ended']),
  startsAt: timestamp,
  trialEndsAt: timestamp.nullable(),
  endsAt: timestamp.nullable(),
})

export const tenantFeatureOverrideSchema = z.object({
  id,
  featureCode: z.string().min(1),
  featureName: z.string().min(1).optional(),
  startsAt: timestamp,
  endsAt: timestamp,
  reason: z.string().min(3).max(240),
})

export const subscriptionContextSchema = z.object({
  canManage: z.boolean(),
  features: z.array(z.object({ code: z.string().min(1), name: z.string().min(1) })),
  plans: z.array(subscriptionPlanSchema),
  tenants: z.array(
    z.object({
      tenantId: id,
      tenantName: z.string().min(1),
      tenantStatus: tenantStatusSchema,
      subscription: tenantSubscriptionSchema.nullable(),
      activeOverrides: z.array(tenantFeatureOverrideSchema),
    }),
  ),
})

export const subscriptionPlanCreateRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(60),
  name: z.string().trim().min(2).max(120),
  defaultTrialDays: z.number().int().min(0).max(365).default(0),
  features: z
    .array(
      z.object({ featureCode: z.string().min(1), limitValue: z.number().int().nonnegative().nullable().default(null) }),
    )
    .max(64)
    .refine((features) => new Set(features.map((feature) => feature.featureCode)).size === features.length, {
      message: 'Plan features must be unique.',
    }),
})

export const subscriptionAssignmentRequestSchema = z
  .object({
    planId: id,
    trialEndsAt: timestamp.nullable().default(null),
    endsAt: timestamp.nullable().default(null),
    reason: z.string().trim().min(3).max(240),
  })
  .refine((request) => !(request.trialEndsAt && request.endsAt), {
    message: 'Use either a trial end or a subscription end.',
  })

export const subscriptionAssignmentResponseSchema = z.object({
  tenantId: id,
  subscriptionId: id,
  planId: id,
  planName: z.string().min(1),
  status: z.enum(['trialing', 'active']),
  startsAt: timestamp,
  trialEndsAt: timestamp.nullable(),
  endsAt: timestamp.nullable(),
})

export const tenantFeatureOverrideCreateRequestSchema = z.object({
  featureCode: z.string().min(1),
  endsAt: timestamp,
  reason: z.string().trim().min(3).max(240),
})

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
export type SubscriptionContext = z.infer<typeof subscriptionContextSchema>
export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>
export type SubscriptionPlanCreateRequest = z.infer<typeof subscriptionPlanCreateRequestSchema>
export type SubscriptionAssignmentRequest = z.infer<typeof subscriptionAssignmentRequestSchema>
export type SubscriptionAssignmentResponse = z.infer<typeof subscriptionAssignmentResponseSchema>
export type TenantFeatureOverride = z.infer<typeof tenantFeatureOverrideSchema>
export type TenantFeatureOverrideCreateRequest = z.infer<typeof tenantFeatureOverrideCreateRequestSchema>
export type SupportAccessGrant = z.infer<typeof supportAccessGrantSchema>
export type SupportAccessContext = z.infer<typeof supportAccessContextSchema>
export type SupportAccessCreateRequest = z.infer<typeof supportAccessCreateRequestSchema>
export type SupportAccessRevokeRequest = z.infer<typeof supportAccessRevokeRequestSchema>
export type SupportAccessOverview = z.infer<typeof supportAccessOverviewSchema>
