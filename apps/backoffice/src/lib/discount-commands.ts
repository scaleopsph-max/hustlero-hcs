import { z } from 'zod'
import { retailDiscountCommandSchema, retailDiscountSchema } from '@hcs/contracts'

const pendingSchema = z.strictObject({ key: z.uuid(), payload: retailDiscountCommandSchema })
export type PendingDiscount = z.infer<typeof pendingSchema>
export function restoreDiscountCommand(raw: string | null): PendingDiscount | null {
  return raw === null ? null : pendingSchema.parse(JSON.parse(raw))
}
export function discountCommandMatches(a: PendingDiscount, b: PendingDiscount | null) {
  return b !== null && a.key === b.key && JSON.stringify(a.payload) === JSON.stringify(b.payload)
}
export function reconcileDiscount(command: PendingDiscount, response: unknown, exactVersion: unknown) {
  const result = retailDiscountSchema.parse(response),
    proof = retailDiscountSchema.parse(exactVersion),
    body = command.payload
  if (
    JSON.stringify(result) !== JSON.stringify(proof) ||
    (body.action !== 'create' && (result.id !== body.discountId || result.revision !== body.expectedRevision + 1)) ||
    (body.action === 'create' && result.revision !== 1) ||
    result.status !== (body.action === 'archive' ? 'archived' : body.status) ||
    (body.action !== 'archive' &&
      (result.name !== body.name || JSON.stringify(result.value) !== JSON.stringify(body.value)))
  ) {
    throw new Error('Discount result could not be reconciled. Retry the original command.')
  }
  return result
}
export function discountDefinitivelyRejected(code: string | undefined) {
  return ['DISCOUNT_DUPLICATE', 'DISCOUNT_ARCHIVED', 'DISCOUNT_REVISION_CONFLICT', 'DISCOUNT_NOT_FOUND'].includes(
    code ?? '',
  )
}
export function parseDiscountValue(kind: 'fixed' | 'percent', input: string) {
  if (!/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(input))
    throw new Error('Enter a positive value with at most two decimal places.')
  const [whole = '', decimals = ''] = input.split('.')
  const scaled = BigInt(whole) * 100n + BigInt(decimals.padEnd(2, '0'))
  if (scaled < 1n || scaled > (kind === 'fixed' ? 99_999_999_999n : 9999n))
    throw new Error(
      kind === 'percent' ? 'Percent must be 0.01 to 99.99.' : 'Discount amount is outside the supported range.',
    )
  return kind === 'fixed' ? { kind, amountMinor: Number(scaled) } : { kind, rateBps: Number(scaled) }
}
export function discountDecimal(value: number) {
  return `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, '0')}`
}
