import type { ResellerCatalogItem } from '@hcs/contracts'

export type CartLine = { variantId: string; quantityMilli: number }

export type CartRow = CartLine & {
  item: ResellerCatalogItem
  lineTotalMinor: number
  potentialProfitMinor: number
}

export type GroupShortfall = {
  pricingGroupId: string
  pricingGroupName: string
  thresholdMilli: number
  neededMilli: number
}

export type CartSummary = {
  rows: CartRow[]
  /** Lines whose item is no longer in the reseller's catalog. */
  missingVariantIds: string[]
  itemCount: number
  totalMinor: number
  potentialProfitMinor: number
  shortfalls: GroupShortfall[]
  hasOutOfStock: boolean
}

const MILLI = 1000n

/**
 * Same rounding as the database: round((quantity / 1000) * unit price, 2), half away from zero.
 * BigInt keeps large quantities and prices exact.
 */
export function lineAmountMinor(unitMinor: number, quantityMilli: number): number {
  const product = BigInt(unitMinor) * BigInt(quantityMilli)
  const negative = product < 0n
  const magnitude = negative ? -product : product
  const rounded = (magnitude + MILLI / 2n) / MILLI
  return Number(negative ? -rounded : rounded)
}

export function summarizeCart(lines: CartLine[], items: ResellerCatalogItem[]): CartSummary {
  const byVariant = new Map(items.map((item) => [item.variantId, item]))
  const rows: CartRow[] = []
  const missingVariantIds: string[] = []
  for (const line of lines) {
    const item = byVariant.get(line.variantId)
    if (!item) {
      missingVariantIds.push(line.variantId)
      continue
    }
    const lineTotalMinor = lineAmountMinor(item.unitPriceMinor, line.quantityMilli)
    rows.push({
      ...line,
      item,
      lineTotalMinor,
      potentialProfitMinor: lineAmountMinor(item.srpMinor, line.quantityMilli) - lineTotalMinor,
    })
  }

  const groups = new Map<string, GroupShortfall & { orderedMilli: number; thresholdMilli: number }>()
  for (const row of rows) {
    const group = groups.get(row.item.pricingGroupId) ?? {
      pricingGroupId: row.item.pricingGroupId,
      pricingGroupName: row.item.pricingGroupName,
      thresholdMilli: row.item.thresholdMilli,
      orderedMilli: 0,
      neededMilli: 0,
    }
    group.orderedMilli += row.quantityMilli
    groups.set(row.item.pricingGroupId, group)
  }
  const shortfalls = [...groups.values()]
    .filter((group) => group.orderedMilli < group.thresholdMilli)
    .map(({ pricingGroupId, pricingGroupName, thresholdMilli, orderedMilli }) => ({
      pricingGroupId,
      pricingGroupName,
      thresholdMilli,
      neededMilli: thresholdMilli - orderedMilli,
    }))

  return {
    rows,
    missingVariantIds,
    itemCount: rows.length,
    totalMinor: rows.reduce((sum, row) => sum + row.lineTotalMinor, 0),
    potentialProfitMinor: rows.reduce((sum, row) => sum + row.potentialProfitMinor, 0),
    shortfalls,
    hasOutOfStock: rows.some((row) => row.item.stockStatus === 'out_of_stock'),
  }
}

/** Adds or replaces a line. A quantity of zero or less removes it. */
export function setCartQuantity(lines: CartLine[], variantId: string, quantityMilli: number): CartLine[] {
  const rest = lines.filter((line) => line.variantId !== variantId)
  if (!Number.isSafeInteger(quantityMilli) || quantityMilli <= 0) return rest
  const index = lines.findIndex((line) => line.variantId === variantId)
  const next = { variantId, quantityMilli }
  if (index === -1) return [...rest, next]
  return [...rest.slice(0, index), next, ...rest.slice(index)]
}

export function quantityInCart(lines: CartLine[], variantId: string): number {
  return lines.find((line) => line.variantId === variantId)?.quantityMilli ?? 0
}

/** Whole units are shown to resellers; the API keeps thousandths. */
export function formatQuantity(quantityMilli: number): string {
  const whole = quantityMilli / 1000
  return Number.isInteger(whole)
    ? whole.toLocaleString('en-PH')
    : whole.toLocaleString('en-PH', { maximumFractionDigits: 3 })
}

const cartKey = (tenantId: string) => `hcs.reseller.cart.${tenantId}`

function isCartLine(value: unknown): value is CartLine {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as CartLine).variantId === 'string' &&
    Number.isSafeInteger((value as CartLine).quantityMilli) &&
    (value as CartLine).quantityMilli > 0
  )
}

export function readCart(tenantId: string): CartLine[] {
  try {
    const raw = window.localStorage.getItem(cartKey(tenantId))
    const value: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(value) ? value.filter(isCartLine) : []
  } catch {
    return []
  }
}

export function writeCart(tenantId: string, lines: CartLine[]): void {
  try {
    if (lines.length === 0) window.localStorage.removeItem(cartKey(tenantId))
    else window.localStorage.setItem(cartKey(tenantId), JSON.stringify(lines))
  } catch {
    // The cart is a convenience; a blocked storage keeps it in memory only.
  }
}

/** The delivery fee the order will carry: flat, free from the business's minimum, never for pickup. */
export function shippingFeeFor(
  shipping: { feeMinor: number; freeAboveMinor: number | null } | undefined,
  itemsTotalMinor: number,
  method: 'delivery' | 'pickup',
): number {
  if (!shipping || method === 'pickup' || shipping.feeMinor <= 0) return 0
  if (shipping.freeAboveMinor !== null && itemsTotalMinor >= shipping.freeAboveMinor) return 0
  return shipping.feeMinor
}
