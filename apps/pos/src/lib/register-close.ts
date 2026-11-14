import { parsePeso } from '@hcs/ui'

/** Bills counted one by one; coins are entered as a peso total. Values in centavos. */
export const billDenominations = [
  { id: 'b1000', label: '₱1,000', unit: 100_000 },
  { id: 'b500', label: '₱500', unit: 50_000 },
  { id: 'b200', label: '₱200', unit: 20_000 },
  { id: 'b100', label: '₱100', unit: 10_000 },
  { id: 'b50', label: '₱50', unit: 5_000 },
  { id: 'b20', label: '₱20', unit: 2_000 },
] as const

export type BillCounts = Partial<Record<(typeof billDenominations)[number]['id'], string>>

/** Total counted cash in centavos from bill counts and the coins total typed in pesos. */
export function countedCentavos(bills: BillCounts, coins: string): number {
  const fromBills = billDenominations.reduce((sum, bill) => {
    const pieces = Number.parseInt(bills[bill.id] ?? '', 10)
    return sum + (Number.isFinite(pieces) && pieces > 0 ? pieces * bill.unit : 0)
  }, 0)
  return fromBills + Math.max(0, parsePeso(coins))
}
