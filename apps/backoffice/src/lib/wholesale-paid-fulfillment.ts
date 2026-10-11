import { wholesaleOrderFulfillRequestSchema, type WholesaleOrderContext } from '@hcs/contracts'
import { parsePaymentMoney } from './wholesale-payment'
export function preparePaidFulfillment(
  order: WholesaleOrderContext['orders'][number],
  quantities: Record<string, string>,
  paymentMethodId: string,
  amount: string,
  reference: string,
) {
  const lines = order.lines.flatMap((line) => {
    const value = quantities[line.id]?.trim()
    if (!value) return []
    const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(value)
    if (!match) throw new Error('Enter quantities with at most three decimal places.')
    const milli = BigInt(match[1] ?? '0') * 1000n + BigInt((match[2] ?? '').padEnd(3, '0'))
    if (milli === 0n) return []
    if (
      milli > BigInt(line.orderedQuantityMilli - line.fulfilledQuantityMilli - line.cancelledQuantityMilli) ||
      milli > BigInt(Number.MAX_SAFE_INTEGER)
    )
      throw new Error('Quantity exceeds the reserved remainder.')
    return [{ salesOrderLineId: line.id, quantityMilli: Number(milli) }]
  })
  return wholesaleOrderFulfillRequestSchema.parse({
    lines,
    payment: { paymentMethodId, amountMinor: parsePaymentMoney(amount), reference },
  })
}
export function paidFulfillmentDefinitivelyRejected(code?: string): boolean {
  return /^WHOLESALE_PAID_HCSP[123]$/.test(code ?? '')
}
