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

function wholeQuantity(value: number, positive: boolean): bigint {
  const quantity = nonnegative(value)
  if ((positive && quantity === 0n) || quantity % 1000n !== 0n) {
    throw new Error('Only positive whole-unit return quantities are supported; history may contain zero.')
  }
  return quantity / 1000n
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
    const fulfilled = wholeQuantity(snapshot.fulfilledQuantityMilli, true)
    const returned = wholeQuantity(snapshot.returnedQuantityMilli, false)
    const quantity = wholeQuantity(selection.quantityMilli, true)
    const price = nonnegative(snapshot.unitPriceMinor)
    const originalTotal = nonnegative(snapshot.originalTotalMinor)
    const priorCredit = nonnegative(snapshot.priorCreditMinor)
    if (nonnegative(snapshot.discountMinor) !== 0n || nonnegative(snapshot.taxMinor) !== 0n) {
      throw new Error('Discounted or taxed returns require a separately verified valuation policy.')
    }
    if (price === 0n || fulfilled * price !== originalTotal || returned * price !== priorCredit) {
      throw new Error('Invoice amount and return history do not reconcile.')
    }
    if (returned > fulfilled || quantity > fulfilled - returned) throw new Error('Return exceeds remaining quantity.')
    const amount = quantity * price
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
