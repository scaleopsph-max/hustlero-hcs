import { z } from 'zod'
import {
  wholesaleCreditSettingsRequestSchema,
  wholesaleCreditSettingsResponseSchema,
  wholesaleOpeningReceivableRequestSchema,
  wholesaleOpeningReceivableResponseSchema,
  type WholesaleCreditSettingsContext,
  type WholesaleReceivablesContext,
} from '@hcs/contracts'
import { parsePaymentMoney } from './wholesale-payment'

const identity = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/)
export const pendingCreditCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('settings'), key: identity, payload: wholesaleCreditSettingsRequestSchema }).strict(),
  z.object({ kind: z.literal('opening'), key: identity, payload: wholesaleOpeningReceivableRequestSchema }).strict(),
])
export type PendingCreditCommand = z.infer<typeof pendingCreditCommandSchema>

export function prepareCreditSettings(
  data: WholesaleCreditSettingsContext,
  customerId: string,
  paymentTerm: string,
  limit: string,
  reason: string,
) {
  if (!data.canManage || !data.customers.some((row) => row.customerId === customerId))
    throw new Error('Select an authorized active reseller.')
  return wholesaleCreditSettingsRequestSchema.parse({
    customerId,
    paymentTerm,
    creditLimitMinor: parsePaymentMoney(limit),
    reason,
  })
}

export function prepareOpeningReceivable(
  data: WholesaleReceivablesContext,
  invoiceId: string,
  dueDate: string,
  reason: string,
  confirmed: boolean,
) {
  const invoice = data.invoices.find((row) => row.invoiceId === invoiceId)
  if (
    !data.canRecordOpening ||
    !invoice?.eligibleForOpening ||
    invoice.classification !== 'unclassified' ||
    invoice.totalMinor <= 0
  )
    throw new Error('Select an eligible unclassified legacy invoice.')
  if (!confirmed) throw new Error('Confirm the original invoice is unpaid before recording opening debt.')
  return wholesaleOpeningReceivableRequestSchema.parse({ invoiceId, dueDate, reason })
}

export function creditCommandDefinitivelyRejected(kind: PendingCreditCommand['kind'], code?: string) {
  // Scope/permission and unknown failures can occur after a committed command; retain its identity.
  return kind === 'settings' ? code === 'WHOLESALE_CREDIT_HCCS2' : /^WHOLESALE_RECEIVABLE_HCAR[24]$/.test(code ?? '')
}

export function validateCreditCommandResponse(command: PendingCreditCommand, value: unknown) {
  if (command.kind === 'settings') {
    const result = wholesaleCreditSettingsResponseSchema.parse(value)
    if (
      result.customerId !== command.payload.customerId ||
      result.paymentTerm !== command.payload.paymentTerm ||
      result.creditLimitMinor !== command.payload.creditLimitMinor
    )
      throw new Error('Settings response does not match the pending request.')
    return result
  }
  const result = wholesaleOpeningReceivableResponseSchema.parse(value)
  if (result.invoiceId !== command.payload.invoiceId || result.dueDate !== command.payload.dueDate)
    throw new Error('Opening response does not match the pending request.')
  return result
}
