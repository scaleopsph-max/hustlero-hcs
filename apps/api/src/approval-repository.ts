import {
  approvalCenterSchema,
  approvalDecisionResponseSchema,
  approvalPolicyUpdateResponseSchema,
  type ApprovalCenter,
  type ApprovalDecisionRequest,
  type ApprovalDecisionResponse,
  type ApprovalPolicyUpdateRequest,
  type ApprovalPolicyUpdateResponse,
} from '@hcs/contracts'
import { Client } from 'pg'

import type { Bindings } from './env'

export type ApprovalCenterLoader = (userId: string, tenantId: string, bindings: Bindings) => Promise<ApprovalCenter>
export type ApprovalPolicyUpdater = (
  userId: string,
  tenantId: string,
  request: ApprovalPolicyUpdateRequest,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<ApprovalPolicyUpdateResponse>
export type ApprovalRequestDecider = (
  userId: string,
  tenantId: string,
  approvalRequestId: string,
  request: ApprovalDecisionRequest,
  idempotencyKey: string,
  requestHash: string,
  requestId: string,
  bindings: Bindings,
) => Promise<ApprovalDecisionResponse>

function connectionString(bindings: Bindings): string {
  if (!bindings.HYPERDRIVE?.connectionString) throw new Error('HYPERDRIVE binding is not configured.')
  return bindings.HYPERDRIVE.connectionString
}

function scaledToDecimal(value: number, scale: number): string {
  const divisor = 10 ** scale
  return `${Math.floor(value / divisor)}.${String(value % divisor).padStart(scale, '0')}`
}

export const loadApprovalCenterFromPostgres: ApprovalCenterLoader = async (userId, tenantId, bindings) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query('select app.list_approval_center($1::uuid, $2::uuid) as context', [
      userId,
      tenantId,
    ])
    return approvalCenterSchema.parse(result.rows[0]?.context)
  } finally {
    await client.end()
  }
}

export const updateApprovalPolicyInPostgres: ApprovalPolicyUpdater = async (
  userId,
  tenantId,
  request,
  idempotencyKey,
  requestHash,
  requestId,
  bindings,
) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query(
      'select app.update_inventory_adjustment_approval_policy($1::uuid, $2::uuid, $3::numeric, $4::text, $5::text, $6::text) as response',
      [
        userId,
        tenantId,
        request.inventoryAdjustmentThresholdMilli === null
          ? null
          : scaledToDecimal(request.inventoryAdjustmentThresholdMilli, 3),
        idempotencyKey,
        requestHash,
        requestId,
      ],
    )
    return approvalPolicyUpdateResponseSchema.parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}

export const decideApprovalRequestInPostgres: ApprovalRequestDecider = async (
  userId,
  tenantId,
  approvalRequestId,
  request,
  idempotencyKey,
  requestHash,
  requestId,
  bindings,
) => {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query(
      'select app.decide_approval_request($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::text, $8::text) as response',
      [userId, tenantId, approvalRequestId, request.decision, request.note, idempotencyKey, requestHash, requestId],
    )
    return approvalDecisionResponseSchema.parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}
