import { z } from 'zod'
import {
  wholesaleFundReversalRequestSchema,
  wholesaleFundReversalResponseSchema,
  type WholesaleFundsContext,
} from '@hcs/contracts'

export const pendingFundReversalSchema = z.strictObject({
  key: z.string().uuid(),
  payload: wholesaleFundReversalRequestSchema,
})
export type PendingFundReversal = z.infer<typeof pendingFundReversalSchema>
export function fundReversalDefinitivelyRejected(code: unknown): boolean {
  // These conflicts occur only after actor/body-bound historical replay was checked.
  return typeof code === 'string' && /^WHOLESALE_FUNDS_HCFD[678]$/.test(code)
}
export function restoreFundReversal(stored: string | null): PendingFundReversal | null {
  return stored === null ? null : pendingFundReversalSchema.parse(JSON.parse(stored))
}
export function reconcileFundReversal(command: PendingFundReversal, value: unknown, history: WholesaleFundsContext) {
  const result = wholesaleFundReversalResponseSchema.parse(value)
  const payment = history.payments.find((row) => row.paymentId === command.payload.paymentId)
  if (
    result.paymentId !== command.payload.paymentId ||
    !payment?.allocation ||
    !payment.reversal ||
    result.reversalId !== payment.reversal.reversalId ||
    result.recordedAt !== payment.reversal.recordedAt ||
    result.capitalMinor !== payment.allocation.capitalMinor ||
    result.operatingMinor !== payment.allocation.operatingMinor ||
    result.capitalMinor !== payment.reversal.capitalMinor ||
    result.operatingMinor !== payment.reversal.operatingMinor
  ) {
    throw new Error('Reversal could not be reconciled. Retry the original command.')
  }
  return result
}
