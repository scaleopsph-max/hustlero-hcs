export type WholesaleReturnLineSnapshot = {
  invoiceLineId: string
  fulfilledQuantityMilli: number
  returnedQuantityMilli: number
  unitPriceMinor: number
  originalTotalMinor: number
  priorCreditMinor: number
  discountMinor: number
  taxMinor: number
}

export type WholesaleReturnLineSelection = {
  invoiceLineId: string
  quantityMilli: number
  returnToStock: boolean
}

function nonnegative(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Expected nonnegative safe integer units.')
  return BigInt(value)
}

function safe(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount exceeds supported range.')
  return Number(value)
}

function milliQuantity(value: number, positive: boolean): bigint {
  const quantity = nonnegative(value)
  if (positive && quantity === 0n) {
    throw new Error('Return quantity must be a positive integer in milli-units.')
  }
  return quantity
}

// Nonnegative half-up rounding, identical to PostgreSQL round(numeric).
function proportional(amount: bigint, quantity: bigint, fulfilled: bigint): bigint {
  return (amount * quantity * 2n + fulfilled) / (2n * fulfilled)
}

// Snapshots must be loaded by the authorized server; this pure quote does not authorize or post a return.
export function quoteWholesaleReturn(
  snapshots: readonly WholesaleReturnLineSnapshot[],
  selections: readonly WholesaleReturnLineSelection[],
): {
  totalCreditMinor: number
  lines: (WholesaleReturnLineSelection & { amountMinor: number })[]
} {
  if (selections.length === 0 || selections.length > 200) throw new Error('Select between one and 200 lines.')
  const byId = new Map<string, WholesaleReturnLineSnapshot>()
  for (const snapshot of snapshots) {
    if (!snapshot.invoiceLineId || byId.has(snapshot.invoiceLineId)) throw new Error('Invalid invoice line snapshots.')
    byId.set(snapshot.invoiceLineId, snapshot)
  }
  const seen = new Set<string>()
  let total = 0n
  const lines = selections.map((selection) => {
    if (seen.has(selection.invoiceLineId)) throw new Error('Duplicate return line.')
    seen.add(selection.invoiceLineId)
    const snapshot = byId.get(selection.invoiceLineId)
    if (!snapshot || typeof selection.returnToStock !== 'boolean') throw new Error('Invalid return line.')
    const fulfilled = milliQuantity(snapshot.fulfilledQuantityMilli, true)
    const returned = milliQuantity(snapshot.returnedQuantityMilli, false)
    const quantity = milliQuantity(selection.quantityMilli, true)
    const price = nonnegative(snapshot.unitPriceMinor)
    const originalTotal = nonnegative(snapshot.originalTotalMinor)
    const priorCredit = nonnegative(snapshot.priorCreditMinor)
    const discount = nonnegative(snapshot.discountMinor)
    const tax = nonnegative(snapshot.taxMinor)
    if (discount > originalTotal) throw new Error('Discount exceeds original line amount.')
    const originalCharge = originalTotal - discount + tax
    safe(originalCharge)
    if (
      price === 0n ||
      originalCharge === 0n ||
      proportional(price, fulfilled, 1000n) !== originalTotal ||
      priorCredit !== proportional(originalCharge, returned, fulfilled)
    ) {
      throw new Error('Invoice amount and return history do not reconcile.')
    }
    if (returned > fulfilled || quantity > fulfilled - returned) throw new Error('Return exceeds remaining quantity.')
    const amount = proportional(originalCharge, returned + quantity, fulfilled) - priorCredit
    if (amount === 0n) throw new Error('Selected quantity has no refundable centavo; select a larger quantity.')
    total += amount
    return { ...selection, amountMinor: safe(amount) }
  })
  return { totalCreditMinor: safe(total), lines }
}

// Inputs are cumulative locked invoice projections, not the spendable customer-credit balance.
export function wholesaleReturnSettlement(input: {
  invoiceTotalMinor: number
  priorReturnCreditMinor: number
  allocatedPaymentMinor: number
  newReturnCreditMinor: number
}): {
  remainingInvoiceChargeMinor: number
  openDebtMinor: number
  debtReductionMinor: number
  newlyIssuedCustomerCreditMinor: number
  cashPayoutMinor: 0
} {
  const original = nonnegative(input.invoiceTotalMinor)
  const prior = nonnegative(input.priorReturnCreditMinor)
  const payments = nonnegative(input.allocatedPaymentMinor)
  const credit = nonnegative(input.newReturnCreditMinor)
  if (original === 0n || credit === 0n || prior > original || credit > original - prior || payments > original) {
    throw new Error('Return settlement exceeds the original invoice or has invalid history.')
  }
  const before = original - prior
  const after = before - credit
  const debtBefore = before > payments ? before - payments : 0n
  const debtAfter = after > payments ? after - payments : 0n
  const entitlementBefore = payments > before ? payments - before : 0n
  const entitlementAfter = payments > after ? payments - after : 0n
  return {
    remainingInvoiceChargeMinor: safe(after),
    openDebtMinor: safe(debtAfter),
    debtReductionMinor: safe(debtBefore - debtAfter),
    newlyIssuedCustomerCreditMinor: safe(entitlementAfter - entitlementBefore),
    cashPayoutMinor: 0,
  }
}
