import { z } from 'zod'
import {
  wholesaleOrderConfirmRequestSchema,
  wholesaleOrderConfirmResponseSchema,
  wholesaleOrderFulfillRequestSchema,
  wholesaleOrderFulfillResponseSchema,
  type WholesaleCreditOverridesContext,
  type WholesaleOrderContext,
} from '@hcs/contracts'
import { prepareFulfillmentLines, paidFulfillmentDefinitivelyRejected } from './wholesale-paid-fulfillment'
const key = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/)
export const pendingOrderActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('confirm'), orderId: z.uuid(), key, payload: wholesaleOrderConfirmRequestSchema }),
  z.strictObject({ kind: z.literal('fulfill'), orderId: z.uuid(), key, payload: wholesaleOrderFulfillRequestSchema }),
])
export type PendingOrderAction = z.infer<typeof pendingOrderActionSchema>
type Order = WholesaleOrderContext['orders'][number]
export function eligibleOrderOverrides(
  context: WholesaleCreditOverridesContext,
  order: Order,
  action: 'confirm' | 'fulfill',
  now = Date.now(),
) {
  return context.overrides.filter(
    (row) =>
      row.salesOrderId === order.id &&
      row.customerId === order.customerId &&
      row.action === action &&
      row.status === 'approved' &&
      !row.revokedAt &&
      !row.consumption &&
      Date.parse(row.expiresAt) > now,
  )
}
export function prepareOrderOverride(
  context: WholesaleCreditOverridesContext,
  order: Order,
  action: 'confirm' | 'fulfill',
  overrideId: string,
) {
  if (!overrideId) return {}
  if (!eligibleOrderOverrides(context, order, action).some((row) => row.overrideId === overrideId))
    throw new Error('Select a currently available approval for this order and action.')
  return { creditOverrideId: overrideId }
}
export function prepareCreditFulfillment(
  order: Order,
  quantities: Record<string, string>,
  override: { creditOverrideId?: string },
) {
  return wholesaleOrderFulfillRequestSchema.parse({ lines: prepareFulfillmentLines(order, quantities), ...override })
}
export function restoreOrderAction(stored: string | null, legacy: string | null): PendingOrderAction | null {
  if (stored && legacy) throw new Error('Multiple pending order commands need reconciliation before another action.')
  if (stored) return pendingOrderActionSchema.parse(JSON.parse(stored))
  if (!legacy) return null
  const value = z
    .strictObject({ orderId: z.uuid(), key, payload: wholesaleOrderFulfillRequestSchema })
    .parse(JSON.parse(legacy))
  if (!value.payload.payment) throw new Error('Invalid legacy paid fulfillment.')
  return { kind: 'fulfill', ...value }
}
export function orderActionDefinitivelyRejected(command: PendingOrderAction, code?: string) {
  // Auth/scope/status failures may hide a previous commit. Keep their original identity.
  if (command.kind === 'fulfill' && command.payload.payment) return paidFulfillmentDefinitivelyRejected(code)
  return (
    code === 'WHOLESALE_OVERRIDE_HCCO6' ||
    code === 'WHOLESALE_CREDIT_HCCR1' ||
    code === 'WHOLESALE_CREDIT_HCCR3' ||
    code === 'WHOLESALE_CREDIT_HCCR4'
  )
}
export function validateOrderActionResponse(command: PendingOrderAction, data: unknown) {
  const result =
    command.kind === 'confirm'
      ? wholesaleOrderConfirmResponseSchema.parse(data)
      : wholesaleOrderFulfillResponseSchema.parse(data)
  if (result.salesOrderId !== command.orderId) throw new Error('Order response does not match the original command.')
  if (
    command.kind === 'fulfill' &&
    'fulfilledQuantityMilli' in result &&
    BigInt(result.fulfilledQuantityMilli) !==
      command.payload.lines.reduce((sum, line) => sum + BigInt(line.quantityMilli), 0n)
  )
    throw new Error('Fulfillment response quantity does not match the original command.')
  return result
}
