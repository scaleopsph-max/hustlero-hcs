export type WholesalePaymentTerm = 'prepaid' | 'cod' | 'net_7' | 'net_15' | 'net_30'
export type ReceivableAgingBucket = 'current' | '1_30' | '31_60' | '61_90' | 'over_90'

const dayMs = 86_400_000

function amount(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Money must be nonnegative safe integer minor units.')
  }
  return BigInt(value)
}

function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error('Money exceeds the supported integer range.')
  }
  return Number(value)
}

function calendarDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('A calendar date is required.')
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error('Invalid calendar date.')
  }
  return timestamp
}

export function wholesaleInvoiceDueDate(issuedAt: string, timezone: string, term: WholesalePaymentTerm): string {
  const terms: Record<WholesalePaymentTerm, number> = { prepaid: 0, cod: 0, net_7: 7, net_15: 15, net_30: 30 }
  if (!Object.hasOwn(terms, term)) throw new Error('Unsupported payment term.')
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(issuedAt)
  ) {
    throw new Error('An offset-aware invoice timestamp is required.')
  }
  calendarDate(issuedAt.slice(0, 10))
  const issued = new Date(issuedAt)
  if (!Number.isFinite(issued.getTime())) throw new Error('Invalid invoice timestamp.')
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(issued)
  const part = (type: string) => parts.find((item) => item.type === type)?.value
  const businessDate = `${part('year')}-${part('month')}-${part('day')}`
  return new Date(calendarDate(businessDate) + terms[term] * dayMs).toISOString().slice(0, 10)
}

export function wholesaleReceivableAging(dueDate: string, asOfBusinessDate: string): ReceivableAgingBucket {
  const days = (calendarDate(asOfBusinessDate) - calendarDate(dueDate)) / dayMs
  if (days <= 0) return 'current'
  if (days <= 30) return '1_30'
  if (days <= 60) return '31_60'
  if (days <= 90) return '61_90'
  return 'over_90'
}

export function wholesaleCreditExposure(input: {
  creditLimitMinor: number
  openReceivablesMinor: number
  confirmedUnfulfilledMinor: number
}): { exposureMinor: number; availableCreditMinor: number; exceedsLimit: boolean } {
  const limit = amount(input.creditLimitMinor)
  const exposure = amount(input.openReceivablesMinor) + amount(input.confirmedUnfulfilledMinor)
  return {
    exposureMinor: safeNumber(exposure),
    availableCreditMinor: safeNumber(limit - exposure),
    exceedsLimit: exposure > limit,
  }
}

// Balances supplied here must come from the authorized transaction's locked ledger projection.
export function validateWholesalePaymentAllocation(
  paymentMinor: number,
  allocations: readonly { invoiceId: string; amountMinor: number; openBalanceMinor: number }[],
): void {
  const payment = amount(paymentMinor)
  if (payment === 0n || allocations.length === 0) throw new Error('A positive allocated payment is required.')
  const seen = new Set<string>()
  let total = 0n
  for (const allocation of allocations) {
    if (!allocation.invoiceId || seen.has(allocation.invoiceId)) throw new Error('Duplicate or missing invoice.')
    seen.add(allocation.invoiceId)
    const allocated = amount(allocation.amountMinor)
    const balance = amount(allocation.openBalanceMinor)
    if (allocated === 0n || allocated > balance) throw new Error('Allocation exceeds the invoice open balance.')
    total += allocated
  }
  if (total !== payment) throw new Error('Allocate the exact payment amount; customer credit must be explicit.')
}

export function assertWholesaleFulfillmentPayment(
  term: WholesalePaymentTerm,
  invoiceTotalMinor: number,
  paymentMinor: number,
): void {
  if (!['prepaid', 'cod', 'net_7', 'net_15', 'net_30'].includes(term)) {
    throw new Error('Unsupported payment term.')
  }
  const total = amount(invoiceTotalMinor)
  const payment = amount(paymentMinor)
  if (payment > total) throw new Error('Payment exceeds invoice total.')
  if ((term === 'prepaid' || term === 'cod') && payment !== total) {
    throw new Error('Prepaid and COD require full payment at fulfillment.')
  }
}
