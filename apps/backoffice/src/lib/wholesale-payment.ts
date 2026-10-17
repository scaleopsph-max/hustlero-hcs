import { z } from 'zod'
import {
  wholesalePaymentAllocationRequestSchema,
  wholesalePaymentAllocationResponseSchema,
  type WholesalePaymentsContext,
  requiresPaymentReference,
  paymentReferenceLastFourSchema,
} from '@hcs/contracts'

export const pendingWholesalePaymentSchema = z.strictObject({
  key: z.string().regex(/^wholesale-payment-[a-f0-9-]{36}$/),
  request: wholesalePaymentAllocationRequestSchema,
})
export type PendingWholesalePayment = z.infer<typeof pendingWholesalePaymentSchema>

export function restoreWholesalePayment(stored: string | null): PendingWholesalePayment | null {
  return stored === null ? null : pendingWholesalePaymentSchema.parse(JSON.parse(stored))
}

export function validateWholesalePaymentResponse(command: PendingWholesalePayment, value: unknown) {
  const response = wholesalePaymentAllocationResponseSchema.parse(value)
  if (
    response.customerId !== command.request.customerId ||
    response.amountMinor !== command.request.amountMinor ||
    response.allocationCount !== command.request.allocations.length
  )
    throw new Error('Payment response does not match the pending request. Retry the original request.')
  return response
}

export function validateWholesalePaymentReceipt(
  command: PendingWholesalePayment,
  paymentId: string,
  context: WholesalePaymentsContext,
) {
  const receipt = context.payments.find((row) => row.paymentId === paymentId)
  const expected = new Map(command.request.allocations.map((row) => [row.invoiceId, row.amountMinor]))
  if (
    !receipt ||
    receipt.customerId !== command.request.customerId ||
    receipt.amountMinor !== command.request.amountMinor ||
    receipt.reference !== command.request.reference ||
    receipt.allocations.length !== expected.size ||
    new Set(receipt.allocations.map((row) => row.invoiceId)).size !== expected.size ||
    receipt.allocations.some((row) => expected.get(row.invoiceId) !== row.amountMinor)
  )
    throw new Error('Recorded receipt does not match the pending request. Retry the original request.')
  return receipt
}

export function parsePaymentMoney(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!match) throw new Error('Enter an amount with at most two decimal places.')
  const amount = BigInt(match[1] ?? '0') * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount is too large.')
  return Number(amount)
}

export function paymentMoneyInput(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error('Invalid money.')
  const cents = BigInt(minor)
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
}

export function paymentRejectedBeforePosting(code: string): boolean {
  // Authorization failures also apply to completed replay, so they cannot prove a payment did not post.
  return /^WHOLESALE_PAYMENT_HCAP[2456]$/.test(code)
}

export function prepareWholesalePayment(
  context: WholesalePaymentsContext,
  customerId: string,
  paymentMethodId: string,
  amount: string,
  reference: string,
  values: Record<string, string>,
) {
  if (!context.canRecord) throw new Error('Payment recording is not authorized.')
  if (!context.paymentMethods.some((method) => method.id === paymentMethodId))
    throw new Error('Select an active payment method.')
  const method = context.paymentMethods.find((item) => item.id === paymentMethodId)
  if (method?.methodType && requiresPaymentReference(method.methodType))
    paymentReferenceLastFourSchema.parse(reference.trim())
  const allocations = Object.entries(values)
    .filter(([, value]) => value.trim() !== '')
    .map(([invoiceId, value]) => {
      const invoice = context.invoices.find((item) => item.invoiceId === invoiceId)
      const amountMinor = parsePaymentMoney(value)
      if (!invoice || invoice.customerId !== customerId || !invoice.canAllocate || invoice.openBalanceMinor === null)
        throw new Error('Select an authorized, classified invoice for this customer.')
      if (amountMinor > invoice.openBalanceMinor) throw new Error('Allocation exceeds the invoice balance.')
      return { invoiceId, amountMinor }
    })
  return wholesalePaymentAllocationRequestSchema.parse({
    customerId,
    paymentMethodId,
    amountMinor: parsePaymentMoney(amount),
    reference,
    allocations,
  })
}
