import { z } from 'zod'
import {
  wholesaleReturnRequestSchema,
  wholesaleReturnResponseSchema,
  wholesaleCreditApplyRequestSchema,
  wholesaleCreditApplyResponseSchema,
  wholesaleCreditRefundRequestSchema,
  wholesaleCreditRefundResponseSchema,
  type WholesaleReturnsContext,
} from '@hcs/contracts'

const key = z.string().uuid()
export const pendingWholesaleReturnSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('return'), key, payload: wholesaleReturnRequestSchema }),
  z.strictObject({ operation: z.literal('apply'), key, payload: wholesaleCreditApplyRequestSchema }),
  z.strictObject({ operation: z.literal('refund'), key, payload: wholesaleCreditRefundRequestSchema }),
])
export type PendingWholesaleReturn = z.infer<typeof pendingWholesaleReturnSchema>
export function restoreWholesaleReturn(stored: string | null): PendingWholesaleReturn | null {
  return stored === null ? null : pendingWholesaleReturnSchema.parse(JSON.parse(stored))
}
export function wholesaleReturnPath(command: PendingWholesaleReturn) {
  return command.operation === 'return' ? '/v1/wholesale/returns' : `/v1/wholesale/credits/${command.operation}`
}
export function reconcileWholesaleReturn(
  command: PendingWholesaleReturn,
  value: unknown,
  history: WholesaleReturnsContext,
): void {
  if (command.operation === 'return') {
    const response = wholesaleReturnResponseSchema.parse(value)
    const note = history.notes.find((row) => row.creditNoteId === response.creditNoteId)
    if (
      response.invoiceId !== command.payload.invoiceId ||
      !note ||
      note.commandKey !== command.key ||
      note.invoiceId !== response.invoiceId ||
      note.refundId !== response.refundId ||
      note.debtReductionMinor !== response.debtReductionMinor ||
      note.issuedCreditMinor !== response.newCustomerCreditMinor ||
      note.amountMinor !== response.amountMinor
    )
      throw new Error('Credit-note result could not be reconciled. Retry the original command.')
  } else if (command.operation === 'apply') {
    const response = wholesaleCreditApplyResponseSchema.parse(value)
    const row = history.applications.find((item) => item.applicationId === response.applicationId)
    if (
      response.creditNoteId !== command.payload.creditNoteId ||
      response.invoiceId !== command.payload.invoiceId ||
      response.amountMinor !== command.payload.amountMinor ||
      !row ||
      row.commandKey !== command.key ||
      row.creditNoteId !== response.creditNoteId ||
      row.invoiceId !== response.invoiceId ||
      row.amountMinor !== response.amountMinor
    )
      throw new Error('Credit application could not be reconciled. Retry the original command.')
  } else {
    const response = wholesaleCreditRefundResponseSchema.parse(value)
    const row = history.payouts.find((item) => item.payoutId === response.payoutId)
    if (
      response.creditNoteId !== command.payload.creditNoteId ||
      response.paymentMethodId !== command.payload.paymentMethodId ||
      response.registerSessionId !== command.payload.registerSessionId ||
      response.referenceLastFour !== command.payload.referenceLastFour ||
      response.amountMinor !== command.payload.amountMinor ||
      !row ||
      row.commandKey !== command.key ||
      row.creditNoteId !== response.creditNoteId ||
      row.paymentMethodId !== response.paymentMethodId ||
      row.registerSessionId !== response.registerSessionId ||
      row.referenceLastFour !== response.referenceLastFour ||
      row.amountMinor !== response.amountMinor
    )
      throw new Error('Refund payout could not be reconciled. Retry the original command.')
  }
}
