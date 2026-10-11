import { wholesalePaymentAllocationRequestSchema, type WholesalePaymentsContext } from '@hcs/contracts'

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
