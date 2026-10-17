/**
 * MOCK DATA for the POS screens. Replace with API calls.
 * All money is integer centavos (see @hcs/ui lib/money.ts).
 */
import type { Centavos } from '@hcs/ui'

export type Category = 'Beverages' | 'Bakery' | 'Pantry' | 'Supplies' | 'Merch'
export const categories: Category[] = ['Beverages', 'Bakery', 'Pantry', 'Supplies', 'Merch']

export type Product = {
  id: string
  name: string
  variant: string
  category: Category
  retail: Centavos
  /** Price when the pricing-group threshold is met (spec section 13.1). Equal to retail when there is none. */
  wholesale: Centavos
  /** Available = on hand minus reserved, per location. From the inventory service, never computed in the UI. */
  available: number
}

/** Low-stock chip threshold. Real value is the SKU reorder level from the API. */
export const LOW_STOCK_AT = 6
/** Wholesale threshold. Real value comes from pricing-group settings (default basis: Pricing Group). */
export const WHOLESALE_MIN_QTY = 12

export const products: Product[] = [
  {
    id: 'cb500o',
    name: 'Cold brew 500 ml',
    variant: 'Original',
    category: 'Beverages',
    retail: 14000,
    wholesale: 11800,
    available: 16,
  },
  {
    id: 'cb500c',
    name: 'Cold brew 500 ml',
    variant: 'Caramel',
    category: 'Beverages',
    retail: 15000,
    wholesale: 12800,
    available: 42,
  },
  {
    id: 'cb1l',
    name: 'Cold brew 1 L',
    variant: 'Original',
    category: 'Beverages',
    retail: 32000,
    wholesale: 27500,
    available: 9,
  },
  {
    id: 'ube6',
    name: 'Ube pandesal',
    variant: 'Pack of 6',
    category: 'Bakery',
    retail: 9500,
    wholesale: 9500,
    available: 60,
  },
  {
    id: 'cheese4',
    name: 'Cheese roll',
    variant: 'Pack of 4',
    category: 'Bakery',
    retail: 11000,
    wholesale: 11000,
    available: 28,
  },
  {
    id: 'ensa',
    name: 'Ensaymada',
    variant: 'Single',
    category: 'Bakery',
    retail: 4500,
    wholesale: 4500,
    available: 24,
  },
  {
    id: 'banana',
    name: 'Banana bread',
    variant: 'Slice',
    category: 'Bakery',
    retail: 7500,
    wholesale: 7500,
    available: 12,
  },
  {
    id: 'sugar',
    name: 'Brown sugar',
    variant: '1 kg',
    category: 'Pantry',
    retail: 7800,
    wholesale: 7800,
    available: 0,
  },
  { id: 'oat', name: 'Oat milk', variant: '1 L', category: 'Pantry', retail: 16500, wholesale: 16500, available: 6 },
  {
    id: 'beans',
    name: 'Coffee beans',
    variant: 'Arabica 250 g',
    category: 'Pantry',
    retail: 42000,
    wholesale: 42000,
    available: 27,
  },
  {
    id: 'drip',
    name: 'Drip bag',
    variant: 'Box of 10',
    category: 'Pantry',
    retail: 26000,
    wholesale: 26000,
    available: 33,
  },
  {
    id: 'cup',
    name: 'Paper cup',
    variant: '12 oz, 50 pcs',
    category: 'Supplies',
    retail: 8500,
    wholesale: 8500,
    available: 210,
  },
  {
    id: 'straw',
    name: 'Reusable straw',
    variant: 'Set of 4',
    category: 'Supplies',
    retail: 13000,
    wholesale: 13000,
    available: 19,
  },
  {
    id: 'tumbler',
    name: 'Tumbler',
    variant: 'Matte green',
    category: 'Merch',
    retail: 65000,
    wholesale: 65000,
    available: 4,
  },
  { id: 'mug', name: 'Mug', variant: 'Ceramic', category: 'Merch', retail: 28000, wholesale: 28000, available: 11 },
  {
    id: 'tote',
    name: 'Tote bag',
    variant: 'Canvas',
    category: 'Merch',
    retail: 22000,
    wholesale: 22000,
    available: 14,
  },
]

export type CartLine = { productId: string; qty: number }
export type PricingMode = 'retail' | 'wholesale'

export const initialCart: CartLine[] = [
  { productId: 'cb500o', qty: 12 },
  { productId: 'ube6', qty: 6 },
]

export function findProduct(id: string): Product {
  const p = products.find((x) => x.id === id)
  if (!p) throw new Error(`Unknown product ${id}`)
  return p
}

export function unitPrice(p: Product, mode: PricingMode): Centavos {
  return mode === 'wholesale' ? p.wholesale : p.retail
}

export function cartTotal(lines: CartLine[], mode: PricingMode): Centavos {
  return lines.reduce((sum, l) => sum + unitPrice(findProduct(l.productId), mode) * l.qty, 0)
}

/** Wholesale applies by itself once any line with a wholesale price reaches the threshold. */
export function wholesaleTriggered(lines: CartLine[]): boolean {
  return lines.some((l) => {
    const p = findProduct(l.productId)
    return p.wholesale < p.retail && l.qty >= WHOLESALE_MIN_QTY
  })
}

/** Cash count denominations, in centavos per unit. Coins are counted as a peso total. */
export const denominations = [
  { id: 'c1000', label: '₱1,000 bills', unit: 100000, count: 15 },
  { id: 'c500', label: '₱500 bills', unit: 50000, count: 8 },
  { id: 'c200', label: '₱200 bills', unit: 20000, count: 5 },
  { id: 'c100', label: '₱100 bills', unit: 10000, count: 4 },
  { id: 'c50', label: '₱50 bills', unit: 5000, count: 3 },
  { id: 'c20', label: '₱20 bills', unit: 2000, count: 5 },
  { id: 'coins', label: 'Coins, total in pesos', unit: 100, count: 45 },
]

/** Register 1 reconciliation. Expected cash comes from the cash ledger, never from the UI. */
export const reconciliation = [
  { label: 'Opening cash', amount: 300000 },
  { label: 'Cash sales', amount: 1824000 },
  { label: 'Cash refunds', amount: -31000 },
  { label: 'Shift expenses', amount: -19000 },
]

/** Real value comes from register settings. Above it, a manager must approve the close. */
export const VARIANCE_LIMIT: Centavos = 2000
