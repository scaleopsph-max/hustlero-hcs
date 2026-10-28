import { z } from 'zod'
import { posSaleCompleteRequestSchema, posSaleCompleteResponseSchema, type PosSalesContext } from '@hcs/contracts'
import { quoteRetailTicketDiscount } from '@hcs/domain'
const scopeSchema = z.strictObject({
  tenantId: z.uuid(),
  deviceId: z.uuid(),
  employeeId: z.uuid(),
  registerId: z.uuid(),
  locationId: z.uuid(),
})
const pendingSchema = z
  .strictObject({
    version: z.literal(1),
    scope: scopeSchema,
    key: z
      .string()
      .refine(
        (value) => value.startsWith('pos_sale_') && z.uuid().safeParse(value.slice(9)).success,
        'Invalid original sale request key.',
      ),
    payload: posSaleCompleteRequestSchema.strict(),
  })
  .refine(
    (value) =>
      value.payload.payments.reduce((sum, payment) => sum + BigInt(payment.amountCentavos), 0n) <=
      BigInt(Number.MAX_SAFE_INTEGER),
    'Payment total is outside the supported range.',
  )
export type PendingPosSale = z.infer<typeof pendingSchema>
export function posSaleScope(context: Pick<PosSalesContext, 'device' | 'employee'>) {
  return scopeSchema.parse({
    tenantId: context.device.tenantId,
    deviceId: context.device.id,
    employeeId: context.employee.id,
    registerId: context.device.registerId,
    locationId: context.device.locationId,
  })
}
export function posSaleStorage(scope: PendingPosSale['scope']) {
  return `hcs-pos-sale:${scope.tenantId}:${scope.deviceId}:${scope.employeeId}:${scope.registerId}:${scope.locationId}`
}
export function createPendingPosSale(scope: PendingPosSale['scope'], payload: unknown) {
  return pendingSchema.parse({ version: 1, scope, key: `pos_sale_${crypto.randomUUID()}`, payload })
}
export function restorePendingPosSale(raw: string | null) {
  if (raw === null) return null
  const input: unknown = JSON.parse(raw),
    parsed = pendingSchema.parse(input)
  if (JSON.stringify(input) !== JSON.stringify(parsed))
    throw new Error('Saved sale changed. Original recovery must be reviewed.')
  return parsed
}
export function findPendingPosSale(
  storage: Pick<Storage, 'length' | 'key' | 'getItem'>,
  scope: PendingPosSale['scope'],
) {
  let pending: PendingPosSale | null = null
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key?.startsWith(`hcs-pos-sale:${scope.tenantId}:${scope.deviceId}:`)) continue
    const command = restorePendingPosSale(storage.getItem(key))
    if (!command) throw new Error('Saved sale recovery is invalid.')
    requireOriginalPosScope(command, scope)
    if (key !== posSaleStorage(command.scope) || pending)
      throw new Error('Saved sale recovery conflicts. Reconcile the original sale before continuing.')
    pending = command
  }
  return pending
}
export function samePendingPosSale(a: PendingPosSale, b: PendingPosSale | null) {
  return b !== null && JSON.stringify(a) === JSON.stringify(b)
}
export function requireOriginalPosScope(command: PendingPosSale, scope: PendingPosSale['scope']) {
  if (JSON.stringify(command.scope) !== JSON.stringify(scope))
    throw new Error('Sign in as the original cashier on the original device and register.')
}
export function definitivelyRejectedPosSale(code: string | undefined) {
  return [
    'POS_DISCOUNT_CHANGED',
    'POS_DISCOUNT_INELIGIBLE',
    'INSUFFICIENT_STOCK',
    'REGISTER_NOT_OPEN',
    'PAYMENT_METHOD_UNAVAILABLE',
    'POS_PAYMENT_REFERENCE_REQUIRED',
  ].includes(code ?? '')
}
export function reconcilePosSale(command: PendingPosSale, value: unknown) {
  const result = posSaleCompleteResponseSchema.parse(value),
    payload = command.payload
  const fail = () => {
    throw new Error('Sale receipt does not match the saved command. Retry the original sale.')
  }
  if (
    result.payments.length !== payload.payments.length ||
    (result.customerId ?? null) !== (payload.customerId ?? null)
  )
    return fail()
  for (const expected of payload.payments) {
    const actual = result.payments.filter((row) => row.paymentMethodId === expected.paymentMethodId)
    if (
      actual.length !== 1 ||
      actual[0]!.amountCentavos !== expected.amountCentavos ||
      actual[0]!.tenderedCentavos !== expected.tenderedCentavos ||
      actual[0]!.changeCentavos !== expected.tenderedCentavos - expected.amountCentavos
    )
      return fail()
    if (payload.discount && actual[0]!.referenceLastFour !== expected.referenceLastFour) return fail()
  }
  const paid = payload.payments.reduce((sum, row) => sum + BigInt(row.amountCentavos), 0n)
  if (paid !== BigInt(result.totalCentavos)) return fail()
  const cash = result.payments.filter((row) => row.methodType === 'cash')
  if (
    cash.reduce((sum, row) => sum + BigInt(row.tenderedCentavos), 0n) !== BigInt(result.cashReceivedCentavos) ||
    cash.reduce((sum, row) => sum + BigInt(row.changeCentavos), 0n) !== BigInt(result.changeCentavos)
  )
    return fail()
  if (!payload.discount) {
    if ((result.discountCentavos ?? 0) !== 0 || result.discountSnapshot || result.discountLines?.length) return fail()
    return result
  }
  const snapshot = result.discountSnapshot,
    lines = result.discountLines
  if (
    !snapshot ||
    !lines ||
    snapshot.id !== payload.discount.discountId ||
    snapshot.revision !== payload.discount.expectedRevision ||
    snapshot.status !== 'active' ||
    result.pricingType !== 'retail' ||
    lines.length !== payload.lines.length ||
    new Set(lines.map((row) => row.variantId)).size !== lines.length
  )
    return fail()
  for (const expected of payload.lines) {
    if (!lines.some((row) => row.variantId === expected.variantId && row.quantityMilli === expected.quantityMilli))
      return fail()
  }
  const quote = quoteRetailTicketDiscount(
    { ...snapshot, ...snapshot.value },
    {
      channel: 'pos',
      existingDiscountMinor: 0,
      loyaltyRedemptionMinor: 0,
      lines: lines.map((row) => ({
        id: row.saleLineId,
        grossMinor: row.grossMinor,
        taxMinor: 0,
        pricingType: 'retail',
      })),
    },
  )
  if (
    quote.subtotalMinor !== result.subtotalCentavos ||
    quote.discountMinor !== result.discountCentavos ||
    quote.totalMinor !== result.totalCentavos
  )
    return fail()
  for (const expected of quote.lines) {
    if (
      !lines.some(
        (row) =>
          row.saleLineId === expected.id &&
          row.discountMinor === expected.discountMinor &&
          row.netMinor === expected.netMinor,
      )
    )
      return fail()
  }
  return result
}
