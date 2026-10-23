import { z } from 'zod'
import { wholesaleFundAllocationRequestSchema, wholesaleFundAllocationResponseSchema } from '@hcs/contracts'

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

export function fundAllocationDefinitivelyRejected(code: string | undefined): boolean {
  // A receipt already allocated by another command can never be allocated again.
  // Permission and unknown failures still cannot prove the original request did not post.
  return /^WHOLESALE_FUNDS_HCFD[2345]$/.test(code ?? '') || code === 'WHOLESALE_RETURN_HCWR5'
}
