/** Server-loaded, immutable sale values. Current catalog/discount definitions are deliberately absent. */
export type RetailDiscountReturnSnapshot = {
  subtotalMinor: number
  discountMinor: number
  totalMinor: number
  refundedMinor: number
  lines: readonly {
    saleLineId: string
    quantityMilli: number
    grossMinor: number
    discountMinor: number
    netMinor: number
    refundedQuantityMilli: number
    refundedMinor: number
  }[]
}

export type RetailDiscountReturnSelection = {
  saleLineId: string
  quantityMilli: number
  returnToStock: boolean
}

const maximum = 99_999_999_999n
function integer(value: number, money = true): bigint {
  if (!Number.isSafeInteger(value) || value < 0 || (money && BigInt(value) > maximum))
    throw new Error('Expected nonnegative safe integer snapshot units within the retail limit.')
  return BigInt(value)
}
function halfUp(amount: bigint, quantity: bigint, originalQuantity: bigint): bigint {
  return (amount * quantity * 2n + originalQuantity) / (originalQuantity * 2n)
}

/**
 * Pure valuation, not permission or payout authorization. The caller must lock and
 * reconcile the complete sale, original snapshots and committed refund history.
 * Compute the cumulative net entitlement, then subtract previously paid cents:
 * splitting returns never creates extra cents and the final remainder is exact.
 */
export function quoteRetailDiscountReturn(
  snapshot: RetailDiscountReturnSnapshot,
  selections: readonly RetailDiscountReturnSelection[],
) {
  const subtotal = integer(snapshot.subtotalMinor)
  const discount = integer(snapshot.discountMinor)
  const payable = integer(snapshot.totalMinor)
  const refunded = integer(snapshot.refundedMinor)
  if (discount === 0n || discount >= subtotal || payable !== subtotal - discount || refunded > payable)
    throw new Error('Discounted sale header does not reconcile.')
  if (snapshot.lines.length < 1 || snapshot.lines.length > 200 || selections.length < 1 || selections.length > 200)
    throw new Error('Select between one and 200 original sale lines.')

  const byId = new Map<string, RetailDiscountReturnSnapshot['lines'][number]>()
  let grossSum = 0n,
    discountSum = 0n,
    netSum = 0n,
    refundSum = 0n
  for (const line of snapshot.lines) {
    if (!line.saleLineId.trim() || line.saleLineId.length > 128 || byId.has(line.saleLineId))
      throw new Error('Original sale line identities must be distinct.')
    byId.set(line.saleLineId, line)
    const quantity = integer(line.quantityMilli, false)
    const returned = integer(line.refundedQuantityMilli, false)
    const gross = integer(line.grossMinor)
    const allocated = integer(line.discountMinor)
    const net = integer(line.netMinor)
    const paid = integer(line.refundedMinor)
    if (
      quantity === 0n ||
      returned > quantity ||
      allocated > gross ||
      net !== gross - allocated ||
      paid !== halfUp(net, returned, quantity)
    )
      throw new Error('Original line amounts or cumulative refund history do not reconcile.')
    grossSum += gross
    discountSum += allocated
    netSum += net
    refundSum += paid
  }
  if (grossSum !== subtotal || discountSum !== discount || netSum !== payable || refundSum !== refunded)
    throw new Error('Complete line snapshots and sale totals do not reconcile.')

  let grossThrough = 0n,
    discountThrough = 0n
  for (const line of [...snapshot.lines].sort((a, b) =>
    a.saleLineId < b.saleLineId ? -1 : a.saleLineId > b.saleLineId ? 1 : 0,
  )) {
    grossThrough += integer(line.grossMinor)
    const through = halfUp(discount, grossThrough, subtotal)
    if (integer(line.discountMinor) !== through - discountThrough)
      throw new Error('Original discount line allocation does not reconcile.')
    discountThrough = through
  }

  const selected = new Set<string>()
  let amount = 0n
  const lines = selections.map((selection) => {
    const line = byId.get(selection.saleLineId)
    if (!line || selected.has(selection.saleLineId) || typeof selection.returnToStock !== 'boolean')
      throw new Error('Return selection must identify distinct original sale lines.')
    selected.add(selection.saleLineId)
    const quantity = integer(selection.quantityMilli, false)
    const returned = integer(line.refundedQuantityMilli, false)
    const original = integer(line.quantityMilli, false)
    if (quantity === 0n || quantity > original - returned) throw new Error('Return exceeds remaining quantity.')
    const through = halfUp(integer(line.netMinor), returned + quantity, original)
    const refund = through - integer(line.refundedMinor)
    // No implicit free restock or zero-only payout policy. Keep the existing guard.
    if (refund === 0n) throw new Error('Selected quantity has no refundable centavo; select a larger quantity.')
    amount += refund
    return {
      ...selection,
      amountMinor: Number(refund),
      cumulativeRefundMinor: Number(through),
      remainingQuantityMilli: Number(original - returned - quantity),
    }
  })
  if (amount > payable - refunded) throw new Error('Return exceeds the original remaining payment.')
  return {
    amountMinor: Number(amount),
    remainingRefundableMinor: Number(payable - refunded - amount),
    // Financial exhaustion is not an instruction to change sale/stock status.
    // Rounding or zero-net lines may leave physical quantity after the last cent.
    paymentFullyReversed: refunded + amount === payable,
    hasUnreturnedQuantity: snapshot.lines.some((line) => {
      const requested = lines.find((selection) => selection.saleLineId === line.saleLineId)
      return (
        integer(line.quantityMilli, false) >
        integer(line.refundedQuantityMilli, false) + BigInt(requested?.quantityMilli ?? 0)
      )
    }),
    lines,
  }
}
