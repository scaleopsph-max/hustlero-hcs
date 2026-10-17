import type { PosCustomer, PosSalesContext, PosPricingMode } from '@hcs/contracts'
import type { PosCartLine } from './pos-api'

export type ResolvedPosPricing = {
  eligible: boolean
  error: string | null
  totalCentavos: number
  priceListId: string | null
  priceListName: string | null
  lines: Map<string, { unitPriceCentavos: number; lineTotalCentavos: number; pricingGroupName: string | null }>
}

export function resolvePosPricing(
  items: PosSalesContext['items'],
  cart: PosCartLine[],
  customer: PosCustomer | null,
  pricingType: PosPricingMode,
): ResolvedPosPricing {
  try {
    return resolvePricing(items, cart, customer, pricingType)
  } catch (error) {
    return invalid(error instanceof Error ? error.message : 'Pricing is unavailable.')
  }
}

function resolvePricing(
  items: PosSalesContext['items'],
  cart: PosCartLine[],
  customer: PosCustomer | null,
  pricingType: PosPricingMode,
): ResolvedPosPricing {
  if (
    cart.some((line) => !Number.isSafeInteger(line.quantityMilli) || line.quantityMilli <= 0) ||
    new Set(cart.map((line) => line.variantId)).size !== cart.length
  )
    return invalid('Cart quantities are invalid.')
  const itemById = new Map(items.map((item) => [item.variantId, item]))
  if (cart.some((line) => !itemById.has(line.variantId))) return invalid('A cart item is unavailable.')
  if (pricingType === 'auto') return resolveAutomaticPricing(items, cart, customer)
  if (pricingType === 'retail') {
    const lines = new Map<string, { unitPriceCentavos: number; lineTotalCentavos: number; pricingGroupName: null }>()
    let totalCentavos = 0
    for (const line of cart) {
      const item = itemById.get(line.variantId)
      if (!item) continue
      const lineTotalCentavos = lineMoney(item.retailPriceCentavos, line.quantityMilli)
      totalCentavos = addMoney(totalCentavos, lineTotalCentavos)
      lines.set(line.variantId, {
        unitPriceCentavos: item.retailPriceCentavos,
        lineTotalCentavos,
        pricingGroupName: null,
      })
    }
    return { eligible: true, error: null, totalCentavos, priceListId: null, priceListName: null, lines }
  }

  if (!customer || customer.customerType !== 'reseller') {
    return invalid('Select an active reseller customer for wholesale or dealer pricing.')
  }
  if (!cart.length) return invalid(null)

  const allOptions = items.flatMap((item) => item.pricingOptions).filter((option) => option.pricingType === pricingType)
  const assigned = allOptions.find((option) => option.customerIds.includes(customer.id))
  const defaultOption = allOptions.find((option) => option.isDefault)
  const priceListId = assigned?.priceListId ?? defaultOption?.priceListId
  if (!priceListId) return invalid('No active price list is available for this pricing mode.')

  const selected = cart.map((line) => ({
    line,
    option: itemById.get(line.variantId)?.pricingOptions.find((option) => option.priceListId === priceListId),
  }))
  const groupQuantities = new Map<string, number>()
  for (const { line, option } of selected) {
    if (option)
      groupQuantities.set(option.pricingGroupId, (groupQuantities.get(option.pricingGroupId) ?? 0) + line.quantityMilli)
  }
  const below = selected.find(
    ({ option }) => option && (groupQuantities.get(option.pricingGroupId) ?? 0) < option.thresholdMilli,
  )
  if (below?.option) {
    const current = groupQuantities.get(below.option.pricingGroupId) ?? 0
    return invalid(
      `${below.option.pricingGroupName} needs ${below.option.thresholdMilli / 1000} units; cart has ${current / 1000}.`,
    )
  }

  const lines = new Map<string, { unitPriceCentavos: number; lineTotalCentavos: number; pricingGroupName: string }>()
  let totalCentavos = 0
  for (const { line, option } of selected) {
    if (!option) return invalid('A cart item has no applicable price-list entry.')
    const lineTotalCentavos = lineMoney(option.unitPriceCentavos, line.quantityMilli)
    totalCentavos = addMoney(totalCentavos, lineTotalCentavos)
    lines.set(line.variantId, {
      unitPriceCentavos: option.unitPriceCentavos,
      lineTotalCentavos,
      pricingGroupName: option.pricingGroupName,
    })
  }
  const list = allOptions.find((option) => option.priceListId === priceListId)
  return { eligible: true, error: null, totalCentavos, priceListId, priceListName: list?.priceListName ?? null, lines }
}

function invalid(error: string | null): ResolvedPosPricing {
  return { eligible: false, error, totalCentavos: 0, priceListId: null, priceListName: null, lines: new Map() }
}

function lineMoney(unit: number, quantityMilli: number): number {
  if (!Number.isSafeInteger(unit) || unit < 0) throw new Error('Invalid unit price.')
  const result = (BigInt(unit) * BigInt(quantityMilli) + 500n) / 1000n
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Sale total exceeds the supported range.')
  return Number(result)
}

function addMoney(left: number, right: number): number {
  const result = BigInt(left) + BigInt(right)
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Sale total exceeds the supported range.')
  return Number(result)
}

function resolveAutomaticPricing(
  items: PosSalesContext['items'],
  cart: PosCartLine[],
  customer: PosCustomer | null,
): ResolvedPosPricing {
  const byId = new Map(items.map((item) => [item.variantId, item]))
  const options = items
    .flatMap((item) => item.pricingOptions)
    .filter((option) => option.pricingType === 'wholesale')
    .sort(
      (a, b) =>
        (b.priceListUpdatedAt ?? '').localeCompare(a.priceListUpdatedAt ?? '') ||
        a.priceListId.localeCompare(b.priceListId),
    )
  const list =
    options.find((option) => customer && option.customerIds.includes(customer.id)) ??
    options.find((option) => option.isDefault)
  const quantities = new Map<string, bigint>()
  for (const line of cart) {
    const categoryId = byId.get(line.variantId)?.categoryId
    if (categoryId) quantities.set(categoryId, (quantities.get(categoryId) ?? 0n) + BigInt(line.quantityMilli))
  }
  const lines: ResolvedPosPricing['lines'] = new Map()
  let totalCentavos = 0
  let wholesale = false
  for (const line of cart) {
    const item = byId.get(line.variantId)!
    const option = item.pricingOptions.find((option) => option.priceListId === list?.priceListId)
    const qualifies = !!(
      item.categoryId &&
      option?.categoryId === item.categoryId &&
      (quantities.get(item.categoryId) ?? 0n) >= BigInt(option.thresholdMilli)
    )
    if (qualifies && customer?.customerType !== 'reseller')
      return invalid('Select an active reseller customer for wholesale pricing.')
    const unitPriceCentavos = qualifies ? option!.unitPriceCentavos : item.retailPriceCentavos
    const lineTotalCentavos = lineMoney(unitPriceCentavos, line.quantityMilli)
    totalCentavos = addMoney(totalCentavos, lineTotalCentavos)
    wholesale ||= qualifies
    lines.set(line.variantId, {
      unitPriceCentavos,
      lineTotalCentavos,
      pricingGroupName: qualifies ? option!.pricingGroupName : null,
    })
  }
  return {
    eligible: true,
    error: null,
    totalCentavos,
    lines,
    priceListId: wholesale ? list!.priceListId : null,
    priceListName: wholesale ? list!.priceListName : null,
  }
}
