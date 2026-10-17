import { z } from 'zod'

const id = z.uuid()

export const notificationCategorySchema = z.enum(['alert', 'approval', 'system'])
export const notificationSeveritySchema = z.enum(['info', 'attention', 'warning', 'critical'])
export const notificationDeliveryStatusSchema = z.enum(['pending', 'delivered', 'failed', 'not_configured'])

export const notificationItemSchema = z.object({
  id,
  category: notificationCategorySchema,
  severity: notificationSeveritySchema,
  title: z.string().min(1),
  message: z.string().min(1),
  linkedEntityType: z.string().nullable(),
  linkedEntityId: id.nullable(),
  locationId: id.nullable(),
  locationName: z.string().nullable(),
  href: z.string().startsWith('/'),
  groupKey: z.string().min(1),
  delivery: z.object({
    inApp: notificationDeliveryStatusSchema,
    email: notificationDeliveryStatusSchema,
  }),
  readAt: z.iso.datetime({ offset: true }).nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime({ offset: true }),
})

export const notificationCenterSchema = z.object({
  unreadCount: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  items: z.array(notificationItemSchema),
})

export const notificationFilterSchema = z.object({
  unreadOnly: z.boolean(),
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().nonnegative(),
})

export const notificationReadRequestSchema = z.object({ read: z.boolean() })
export const notificationReadResponseSchema = z.object({
  notificationId: id,
  read: z.boolean(),
  unreadCount: z.number().int().nonnegative(),
})
export const notificationsReadAllResponseSchema = z.object({
  markedCount: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
})

export type NotificationCenter = z.infer<typeof notificationCenterSchema>
export type NotificationFilter = z.infer<typeof notificationFilterSchema>
export type NotificationReadRequest = z.infer<typeof notificationReadRequestSchema>
export type NotificationReadResponse = z.infer<typeof notificationReadResponseSchema>
export type NotificationsReadAllResponse = z.infer<typeof notificationsReadAllResponseSchema>
