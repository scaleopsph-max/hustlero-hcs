import { z } from 'zod'
import { saleRefundRequestSchema, saleVoidRequestSchema, type SaleReceiptDetail } from '@hcs/contracts'
import { quoteRetailDiscountReturn } from '@hcs/domain'

export const reversalScope = z.strictObject({ actorId: z.uuid(), tenantId: z.uuid(), saleId: z.uuid() })
export const pendingSaleReversalSchema = z
  .strictObject({
    version: z.literal(1),
    ...reversalScope.shape,
    key: z.uuid(),
    mode: z.enum(['refund', 'void']),
    expectedAmountMinor: z.number().int().positive().max(99_999_999_999),
    body: z.string().min(1).max(50000),
  })
  .superRefine((command, ctx) => {
    try {
      const parsed =
        command.mode === 'refund'
          ? saleRefundRequestSchema.parse(JSON.parse(command.body))
          : saleVoidRequestSchema.parse(JSON.parse(command.body))
      if (JSON.stringify(parsed) !== command.body)
        ctx.addIssue({ code: 'custom', message: 'Original reversal body is not canonical.' })
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Original reversal body is invalid.' })
    }
  })
export type PendingSaleReversal = z.infer<typeof pendingSaleReversalSchema>
export class SaleReversalError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
  }
}
export function canDiscardRejectedReversal(error: unknown) {
  return error instanceof SaleReversalError && ['INVALID_SALE_REVERSAL', 'SALE_REVERSAL_CONFLICT'].includes(error.code)
}
export function decodePendingReversal(raw: string, scope: z.infer<typeof reversalScope>) {
  const command = pendingSaleReversalSchema.parse(JSON.parse(raw))
  if (command.actorId !== scope.actorId || command.tenantId !== scope.tenantId || command.saleId !== scope.saleId)
    throw new Error('The pending reversal belongs to another account or receipt.')
  if (JSON.stringify(command) !== raw)
    throw new Error('Pending reversal storage is inconsistent. Keep it for reconciliation.')
  return command
}
export function quantityToMilli(text: string): number {
  if (text === '') return 0
  if (!/^\d+(\.\d{1,3})?$/.test(text)) throw new Error('Use a nonnegative quantity with up to three decimal places.')
  const [whole, fraction = ''] = text.split('.')
  const value = BigInt(whole!) * 1000n + BigInt(fraction.padEnd(3, '0'))
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Quantity exceeds the supported range.')
  return Number(value)
}
export function quoteSaleReversal(
  receipt: SaleReceiptDetail,
  selections: { saleLineId: string; quantityMilli: number; returnToStock: boolean }[],
) {
  if (receipt.channel !== 'pos' || receipt.taxCentavos !== 0)
    throw new Error('This receipt requires a dedicated return workflow.')
  if (receipt.discountCentavos > 0) {
    const snapshot = receipt.discountReturnSnapshot
    if (
      !snapshot ||
      snapshot.subtotalMinor !== receipt.subtotalCentavos ||
      snapshot.discountMinor !== receipt.discountCentavos ||
      snapshot.totalMinor !== receipt.totalCentavos ||
      snapshot.refundedMinor !== receipt.refundedCentavos ||
      snapshot.lines.length !== receipt.lines.length ||
      snapshot.lines.some(
        (row) =>
          !receipt.lines.some(
            (line) =>
              line.id === row.saleLineId &&
              line.quantityMilli === row.quantityMilli &&
              line.refundedQuantityMilli === row.refundedQuantityMilli &&
              line.lineTotalCentavos === row.grossMinor,
          ),
      )
    )
      throw new Error('The original discounted receipt needs reconciliation.')
    const result = quoteRetailDiscountReturn(snapshot, selections)
    if (result.paymentFullyReversed && result.hasUnreturnedQuantity)
      throw new Error('Select all remaining quantities before exhausting the payment.')
    return result.amountMinor
  }
  const seen = new Set<string>()
  let amount = 0n
  if (!selections.length) throw new Error('Select at least one refund quantity.')
  for (const row of selections) {
    const line = receipt.lines.find((line) => line.id === row.saleLineId)
    if (
      !line ||
      seen.has(row.saleLineId) ||
      !Number.isSafeInteger(row.quantityMilli) ||
      row.quantityMilli <= 0 ||
      row.quantityMilli > line.refundableQuantityMilli
    )
      throw new Error('Select valid remaining refund quantities.')
    seen.add(row.saleLineId)
    amount += (BigInt(line.unitPriceCentavos) * BigInt(row.quantityMilli) * 2n + 1000n) / 2000n
  }
  if (amount <= 0n || amount > BigInt(receipt.refundableCentavos))
    throw new Error('Refund must fit the remaining payment.')
  return Number(amount)
}
