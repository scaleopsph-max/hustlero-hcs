import { z } from 'zod'
import {
  wholesaleCreditOverrideApproveSchema,
  wholesaleCreditOverrideRevokeSchema,
  wholesaleCreditOverrideCommandResponseSchema,
  type WholesaleCreditOverridesContext,
} from '@hcs/contracts'
import { parsePaymentMoney } from './wholesale-payment'

const identity = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/)
export const pendingOverrideCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('approve'), key: identity, payload: wholesaleCreditOverrideApproveSchema }),
  z.strictObject({
    kind: z.literal('revoke'),
    key: identity,
    overrideId: z.uuid(),
    payload: wholesaleCreditOverrideRevokeSchema,
  }),
])
export type PendingOverrideCommand = z.infer<typeof pendingOverrideCommandSchema>
type Order = { id: string; status: string }
export function eligibleOverrideOrders<T extends Order>(orders: T[], action: string) {
  return orders.filter((order) =>
    action === 'confirm'
      ? order.status === 'draft'
      : action === 'fulfill' && ['confirmed', 'partially_fulfilled'].includes(order.status),
  )
}
export function prepareOverrideApproval(
  context: WholesaleCreditOverridesContext,
  orders: Order[],
  orderId: string,
  action: string,
  amount: string,
  expiry: string,
  reason: string,
  now = Date.now(),
) {
  if (!context.canApprove || !eligibleOverrideOrders(orders, action).some((order) => order.id === orderId))
    throw new Error('Select an authorized order and action.')
  const expiresAt = new Date(expiry)
  if (!expiry || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now)
    throw new Error('Choose a future expiry.')
  return wholesaleCreditOverrideApproveSchema.parse({
    salesOrderId: orderId,
    action,
    approvedExcessMinor: parsePaymentMoney(amount),
    expiresAt: expiresAt.toISOString(),
    reason,
  })
}
export function prepareOverrideRevocation(
  context: WholesaleCreditOverridesContext,
  overrideId: string,
  reason: string,
) {
  if (!context.canApprove || !context.overrides.some((row) => row.overrideId === overrideId && !row.revokedAt))
    throw new Error('Select an authorized approval that has not been revoked.')
  return wholesaleCreditOverrideRevokeSchema.parse({ reason })
}
export function overrideCommandPath(command: PendingOverrideCommand) {
  return command.kind === 'approve'
    ? '/v1/wholesale/credit-overrides'
    : `/v1/wholesale/credit-overrides/${command.overrideId}/revoke`
}
export function overrideCommandDefinitivelyRejected(code?: string) {
  // These validations cannot conceal a completed replay; scope/auth/unknown failures can.
  return /^WHOLESALE_OVERRIDE_HCCO[245]$/.test(code ?? '')
}
export function validateOverrideResponse(command: PendingOverrideCommand, value: unknown) {
  const result = wholesaleCreditOverrideCommandResponseSchema.parse(value)
  if (
    result.status !== (command.kind === 'approve' ? 'approved' : 'revoked') ||
    (command.kind === 'revoke' && result.overrideId !== command.overrideId)
  )
    throw new Error('Approval response does not match the pending command.')
  return result
}
