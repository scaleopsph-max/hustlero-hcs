import { z } from 'zod'

const id = z.uuid()

export const alertStatusSchema = z.enum(['open', 'acknowledged', 'resolved', 'dismissed'])
export const alertSeveritySchema = z.enum(['info', 'attention', 'warning', 'critical'])
export const alertCategorySchema = z.enum([
  'cash_register',
  'inventory',
  'sales',
  'employee',
  'expense',
  'orders',
  'finance',
  'system',
])

export const alertItemSchema = z.object({
  id,
  category: alertCategorySchema,
  severity: alertSeveritySchema,
  status: alertStatusSchema,
  title: z.string().min(1),
  message: z.string().min(1),
  entityType: z.string().nullable(),
  entityId: id.nullable(),
  locationId: id.nullable(),
  locationName: z.string().nullable(),
  firstDetectedAt: z.iso.datetime({ offset: true }),
  lastDetectedAt: z.iso.datetime({ offset: true }),
  acknowledgedAt: z.iso.datetime({ offset: true }).nullable(),
  resolvedAt: z.iso.datetime({ offset: true }).nullable(),
  dismissedAt: z.iso.datetime({ offset: true }).nullable(),
  note: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
})

export const alertCenterSchema = z.object({
  canManage: z.boolean(),
  counts: z.object({
    open: z.number().int().nonnegative(),
    acknowledged: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
    dismissed: z.number().int().nonnegative(),
  }),
  alerts: z.array(alertItemSchema),
})

export const alertStatusUpdateRequestSchema = z.object({
  status: z.enum(['acknowledged', 'resolved', 'dismissed']),
  note: z.string().trim().max(240).nullable().default(null),
})

export const alertStatusUpdateResponseSchema = z.object({ alertId: id, status: alertStatusSchema })

export const auditActorTypeSchema = z.enum(['tenant_user', 'pos_employee', 'platform_admin', 'system'])

export const auditActivityItemSchema = z.object({
  id,
  requestId: z.string(),
  actorType: auditActorTypeSchema,
  actorId: id.nullable(),
  actorLabel: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: id.nullable(),
  locationId: id.nullable(),
  locationName: z.string().nullable(),
  reason: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  occurredAt: z.iso.datetime({ offset: true }),
})

export const auditActivityContextSchema = z.object({
  locations: z.array(z.object({ id, code: z.string(), name: z.string() })),
  items: z.array(auditActivityItemSchema),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
})

export const auditActivityFilterSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  locationId: id.nullable(),
  actorType: auditActorTypeSchema.nullable(),
  action: z.string().trim().max(100).nullable(),
  entityType: z.string().trim().max(100).nullable(),
  search: z.string().trim().max(100),
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().min(0),
})

export type AlertCenter = z.infer<typeof alertCenterSchema>
export type AlertStatusUpdateRequest = z.infer<typeof alertStatusUpdateRequestSchema>
export type AlertStatusUpdateResponse = z.infer<typeof alertStatusUpdateResponseSchema>
export type AuditActivityContext = z.infer<typeof auditActivityContextSchema>
export type AuditActivityFilter = z.infer<typeof auditActivityFilterSchema>
