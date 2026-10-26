import { z } from 'zod'
import {
  wholesaleFundAllocationRequestSchema,
  wholesaleFundAllocationResponseSchema,
  wholesaleFundsContextSchema,
} from '@hcs/contracts'

export const pendingFundAllocationSchema = z.strictObject({
  key: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  payload: wholesaleFundAllocationRequestSchema,
})
export type PendingFundAllocation = z.infer<typeof pendingFundAllocationSchema>

export function restoreFundAllocation(stored: string | null): PendingFundAllocation | null {
  return stored === null ? null : pendingFundAllocationSchema.parse(JSON.parse(stored))
}

export function validateFundAllocationResponse(command: PendingFundAllocation, value: unknown) {
  const response = wholesaleFundAllocationResponseSchema.parse(value)
  if (
    response.paymentId !== command.payload.paymentId ||
    response.capitalMinor !== command.payload.capitalMinor ||
    response.operatingMinor !== command.payload.operatingMinor
  )
    throw new Error('Allocation response does not match the pending request. Retry the original request.')
  return response
}

export async function refreshConfirmedFundAllocation(
  command: PendingFundAllocation,
  value: unknown,
  refresh: () => Promise<unknown>,
) {
  const response = validateFundAllocationResponse(command, value)
  const context = wholesaleFundsContextSchema.parse(await refresh())
  const receipts = context.payments.filter((item) => item.paymentId === command.payload.paymentId)
  const receipt = receipts[0]
  if (
    receipts.length !== 1 ||
    !receipt?.allocation ||
    BigInt(receipt.amountMinor) !== BigInt(command.payload.capitalMinor) + BigInt(command.payload.operatingMinor) ||
    receipt.allocation.paymentId !== response.paymentId ||
    receipt.allocation.capitalMinor !== response.capitalMinor ||
    receipt.allocation.operatingMinor !== response.operatingMinor ||
    Date.parse(receipt.allocation.recordedAt) !== Date.parse(response.recordedAt)
  )
    throw new Error('Recorded allocation does not match the pending request. Retry the original request.')
  return context
}

export function fundAllocationDefinitivelyRejected(code: string | undefined): boolean {
  // A receipt already allocated by another command can never be allocated again.
  // Permission and unknown failures still cannot prove the original request did not post.
  return /^WHOLESALE_FUNDS_HCFD[2345]$/.test(code ?? '')
}
