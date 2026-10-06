import type { PosCustomer, PosSalesContext, PricingType } from '@hcs/contracts'
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
  pricingType: PricingType,
): ResolvedPosPricing {
  const itemById = new Map(items.map((item) => [item.variantId, item]))
  if (pricingType === 'retail') {
    const lines = new Map<string, { unitPriceCentavos: number; lineTotalCentavos: number; pricingGroupName: null }>()
    let totalCentavos = 0
    for (const line of cart) {
      const item = itemById.get(line.variantId)
      if (!item) continue
      const lineTotalCentavos = Math.round((item.retailPriceCentavos * line.quantityMilli) / 1000)
      totalCentavos += lineTotalCentavos
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
    const lineTotalCentavos = Math.round((option.unitPriceCentavos * line.quantityMilli) / 1000)
    totalCentavos += lineTotalCentavos
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
