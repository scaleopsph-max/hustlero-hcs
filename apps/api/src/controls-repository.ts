import {
  alertCenterSchema,
  alertStatusUpdateResponseSchema,
  auditActivityContextSchema,
  type AlertCenter,
  type AlertStatusUpdateRequest,
  type AlertStatusUpdateResponse,
  type AuditActivityContext,
  type AuditActivityFilter,
} from '@hcs/contracts'
import { Client } from 'pg'

import type { Bindings } from './env'

export type AlertCenterLoader = (userId: string, tenantId: string, bindings: Bindings) => Promise<AlertCenter>
export type AlertStatusUpdater = (
  userId: string,
  tenantId: string,
  alertId: string,
  request: AlertStatusUpdateRequest,
  requestId: string,
  bindings: Bindings,
) => Promise<AlertStatusUpdateResponse>
export type AuditActivityLoader = (
  userId: string,
  tenantId: string,
  filter: AuditActivityFilter,
  bindings: Bindings,
) => Promise<AuditActivityContext>

function connectionString(bindings: Bindings) {
  if (!bindings.HYPERDRIVE?.connectionString) throw new Error('HYPERDRIVE binding is not configured.')
  return bindings.HYPERDRIVE.connectionString
}

export const loadAlertCenterFromPostgres: AlertCenterLoader = async (userId, tenantId, bindings) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query('select app.load_alert_center($1::uuid,$2::uuid) context', [userId, tenantId])
    return alertCenterSchema.parse(result.rows[0]?.context)
  } finally {
    await client.end()
  }
}

export const updateAlertStatusInPostgres: AlertStatusUpdater = async (
  userId,
  tenantId,
  alertId,
  request,
  requestId,
  bindings,
) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query(
      'select app.update_alert_status($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text) response',
      [userId, tenantId, alertId, request.status, request.note, requestId],
    )
    return alertStatusUpdateResponseSchema.parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}

export const loadAuditActivityFromPostgres: AuditActivityLoader = async (userId, tenantId, filter, bindings) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query(
      'select app.load_audit_activity($1::uuid,$2::uuid,$3::date,$4::date,$5::uuid,$6::text,$7::text,$8::text,$9::text,$10::integer,$11::integer) context',
      [
        userId,
        tenantId,
        filter.from,
        filter.to,
        filter.locationId,
        filter.actorType,
        filter.action,
        filter.entityType,
        filter.search,
        filter.limit,
        filter.offset,
      ],
    )
    return auditActivityContextSchema.parse(result.rows[0]?.context)
  } finally {
    await client.end()
  }
}
