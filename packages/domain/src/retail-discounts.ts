export type RetailDiscountValue = { kind: 'fixed'; amountMinor: number } | { kind: 'percent'; rateBps: number }
export type RetailDiscountDefinition = RetailDiscountValue & {
  id: string
  revision: number
  name: string
  status: 'active' | 'inactive' | 'archived'
}
export type RetailDiscountLine = {
  id: string
  grossMinor: number
  taxMinor: number
  pricingType: 'retail' | 'wholesale' | 'dealer'
}
const maximum = 99_999_999_999n
function minor(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0 || BigInt(value) > maximum)
    throw new Error('Expected nonnegative integer minor units within the retail limit.')
  return BigInt(value)
}
function rounded(value: bigint, divisor: bigint) {
  return (value * 2n + divisor) / (divisor * 2n)
}
/** Pure quote only. Caller must load authorized current definitions and line snapshots. */
export function quoteRetailTicketDiscount(
  definition: RetailDiscountDefinition,
  ticket: {
    channel: 'pos' | 'wholesale'
    lines: readonly RetailDiscountLine[]
    existingDiscountMinor: number
    loyaltyRedemptionMinor: number
  },
) {
  if (
    !definition.id.trim() ||
    !definition.name.trim() ||
    definition.name.length > 80 ||
    !Number.isInteger(definition.revision) ||
    definition.revision < 1 ||
    definition.revision > 2147483647 ||
    definition.status !== 'active'
  )
    throw new Error('An active versioned discount definition is required.')
  if (ticket.channel !== 'pos' || ticket.lines.length < 1 || ticket.lines.length > 200)
    throw new Error('Select one to 200 POS retail lines.')
  if (minor(ticket.existingDiscountMinor) !== 0n || minor(ticket.loyaltyRedemptionMinor) !== 0n)
    throw new Error('Discount stacking and loyalty redemption are unavailable.')
  const seen = new Set<string>()
  const lines = ticket.lines
    .map((line) => {
      if (!line.id.trim() || line.id.length > 128 || seen.has(line.id))
        throw new Error('Retail line identities must be distinct.')
      seen.add(line.id)
      if (line.pricingType !== 'retail' || minor(line.taxMinor) !== 0n)
        throw new Error('Only untaxed retail-only tickets are eligible.')
      return { id: line.id, gross: minor(line.grossMinor) }
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const subtotal = lines.reduce((sum, line) => sum + line.gross, 0n)
  if (subtotal === 0n || subtotal > maximum) throw new Error('Retail subtotal is outside the supported range.')
  let discount: bigint
  let value: RetailDiscountValue
  if (definition.kind === 'fixed') {
    discount = minor(definition.amountMinor)
    value = { kind: 'fixed', amountMinor: definition.amountMinor }
  } else if (definition.kind === 'percent') {
    if (!Number.isSafeInteger(definition.rateBps) || definition.rateBps < 1 || definition.rateBps >= 10000)
      throw new Error('Percent must be between 0.01 and 99.99.')
    discount = rounded(subtotal * BigInt(definition.rateBps), 10000n)
    value = { kind: 'percent', rateBps: definition.rateBps }
  } else throw new Error('Unknown retail discount kind.')
  if (discount <= 0n || discount >= subtotal)
    throw new Error('Discount must leave a positive payable amount and cannot round to zero.')
  let grossThrough = 0n,
    discountThrough = 0n
  const allocated = lines.map((line) => {
    grossThrough += line.gross
    const cumulative = rounded(discount * grossThrough, subtotal),
      amount = cumulative - discountThrough
    discountThrough = cumulative
    return {
      id: line.id,
      grossMinor: Number(line.gross),
      discountMinor: Number(amount),
      netMinor: Number(line.gross - amount),
    }
  })
  return {
    definitionSnapshot: {
      id: definition.id,
      revision: definition.revision,
      name: definition.name,
      scope: 'retail_ticket' as const,
      ...value,
    },
    subtotalMinor: Number(subtotal),
    discountMinor: Number(discount),
    totalMinor: Number(subtotal - discount),
    lines: allocated,
  }
}
