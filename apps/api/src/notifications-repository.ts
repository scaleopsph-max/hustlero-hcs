import {
  notificationCenterSchema,
  notificationReadResponseSchema,
  notificationsReadAllResponseSchema,
  type NotificationCenter,
  type NotificationFilter,
  type NotificationReadResponse,
  type NotificationsReadAllResponse,
} from '@hcs/contracts'
import { Client } from 'pg'

import type { Bindings } from './env'

export type NotificationCenterLoader = (
  userId: string,
  tenantId: string,
  filter: NotificationFilter,
  bindings: Bindings,
) => Promise<NotificationCenter>
export type NotificationReadStateUpdater = (
  userId: string,
  tenantId: string,
  notificationId: string,
  read: boolean,
  bindings: Bindings,
) => Promise<NotificationReadResponse>
export type NotificationsReadAllMarker = (
  userId: string,
  tenantId: string,
  bindings: Bindings,
) => Promise<NotificationsReadAllResponse>

function connectionString(bindings: Bindings) {
  if (!bindings.HYPERDRIVE?.connectionString) throw new Error('HYPERDRIVE binding is not configured.')
  return bindings.HYPERDRIVE.connectionString
}

export const loadNotificationCenterFromPostgres: NotificationCenterLoader = async (
  userId,
  tenantId,
  filter,
  bindings,
) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query(
      'select app.load_notification_center($1::uuid,$2::uuid,$3::boolean,$4::integer,$5::integer) context',
      [userId, tenantId, filter.unreadOnly, filter.limit, filter.offset],
    )
    return notificationCenterSchema.parse(result.rows[0]?.context)
  } finally {
    await client.end()
  }
}

export const updateNotificationReadStateInPostgres: NotificationReadStateUpdater = async (
  userId,
  tenantId,
  notificationId,
  read,
  bindings,
) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query(
      'select app.update_notification_read_state($1::uuid,$2::uuid,$3::uuid,$4::boolean) response',
      [userId, tenantId, notificationId, read],
    )
    return notificationReadResponseSchema.parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}

export const markAllNotificationsReadInPostgres: NotificationsReadAllMarker = async (userId, tenantId, bindings) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query('select app.mark_all_notifications_read($1::uuid,$2::uuid) response', [
      userId,
      tenantId,
    ])
    return notificationsReadAllResponseSchema.parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}
