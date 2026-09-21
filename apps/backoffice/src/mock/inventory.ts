/**
 * MOCK DATA for Inventory (spec section 9). Replace with the Inventory Service API.
 *
 * Doctrine: the inventory balance is a SUMMARY. The movement ledger is the TRUTH.
 * No screen edits a balance directly. Every change is a recorded movement.
 */
export type StockStatus = 'in_stock' | 'low' | 'out'

export type StockRow = {
  sku: string
  name: string
  variant: string
  barcodes: number
  onHand: number
  reserved: number
  inTransit: number
  reorderLevel: number
}

/** available = on_hand - reserved (spec section 9.2). Computed, not stored. */
export const available = (r: StockRow) => r.onHand - r.reserved

export function stockStatus(r: StockRow): StockStatus {
  const a = available(r)
  if (a <= 0) return 'out'
  return a <= r.reorderLevel ? 'low' : 'in_stock'
}

export const statusTone = { in_stock: 'success', low: 'attention', out: 'critical' } as const
export const statusLabel = { in_stock: 'In stock', low: 'Low stock', out: 'Out of stock' } as const

export const stock: StockRow[] = [
  {
    sku: 'CB-500-ORG',
    name: 'Cold brew 500 ml',
    variant: 'Original',
    barcodes: 2,
    onHand: 18,
    reserved: 2,
    inTransit: 0,
    reorderLevel: 20,
  },
  {
    sku: 'CB-500-CRM',
    name: 'Cold brew 500 ml',
    variant: 'Caramel',
    barcodes: 1,
    onHand: 42,
    reserved: 0,
    inTransit: 0,
    reorderLevel: 20,
  },
  {
    sku: 'UP-006',
    name: 'Ube pandesal',
    variant: 'Pack of 6',
    barcodes: 1,
    onHand: 64,
    reserved: 4,
    inTransit: 24,
    reorderLevel: 20,
  },
  {
    sku: 'BS-1KG',
    name: 'Brown sugar',
    variant: '1 kg',
    barcodes: 1,
    onHand: 0,
    reserved: 0,
    inTransit: 48,
    reorderLevel: 10,
  },
  {
    sku: 'OM-1L',
    name: 'Oat milk',
    variant: '1 L',
    barcodes: 1,
    onHand: 9,
    reserved: 3,
    inTransit: 0,
    reorderLevel: 10,
  },
  {
    sku: 'PC-12-50',
    name: 'Paper cup',
    variant: '12 oz, sleeve of 50',
    barcodes: 1,
    onHand: 210,
    reserved: 0,
    inTransit: 0,
    reorderLevel: 50,
  },
  {
    sku: 'CBN-A250',
    name: 'Coffee beans',
    variant: 'Arabica 250 g',
    barcodes: 1,
    onHand: 27,
    reserved: 0,
    inTransit: 0,
    reorderLevel: 10,
  },
  {
    sku: 'TB-MG',
    name: 'Tumbler',
    variant: 'Matte green',
    barcodes: 1,
    onHand: 5,
    reserved: 1,
    inTransit: 0,
    reorderLevel: 6,
  },
  {
    sku: 'DB-010',
    name: 'Drip bag',
    variant: 'Box of 10',
    barcodes: 1,
    onHand: 33,
    reserved: 0,
    inTransit: 0,
    reorderLevel: 10,
  },
  {
    sku: 'TT-CNV',
    name: 'Tote bag',
    variant: 'Canvas',
    barcodes: 1,
    onHand: 14,
    reserved: 0,
    inTransit: 0,
    reorderLevel: 5,
  },
]

/** Movement types from spec section 9.3. */
export type MovementType =
  | 'OPENING_BALANCE'
  | 'SALE'
  | 'REFUND'
  | 'PURCHASE_RECEIPT'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'DAMAGE'
  | 'ADJUSTMENT'
  | 'RETURN_TO_SUPPLIER'

export const movementLabel: Record<MovementType, string> = {
  OPENING_BALANCE: 'Opening balance',
  SALE: 'Sale',
  REFUND: 'Refund',
  PURCHASE_RECEIPT: 'Purchase receipt',
  TRANSFER_OUT: 'Transfer out',
  TRANSFER_IN: 'Transfer in',
  DAMAGE: 'Damage',
  ADJUSTMENT: 'Adjustment',
  RETURN_TO_SUPPLIER: 'Return to supplier',
}

/** Every movement carries: tenant, location, SKU, quantity, type, source reference, actor, timestamp. Newest first. */
export type Movement = {
  type: MovementType
  qty: number
  reference: string
  actor: string
  when: string
  balanceAfter: number
}

export const ledgerBySku: Record<string, Movement[]> = {
  'CB-500-ORG': [
    { type: 'SALE', qty: -2, reference: 'HCS-000482', actor: 'Ana R.', when: 'Today, 2:14 PM', balanceAfter: 18 },
    { type: 'SALE', qty: -1, reference: 'HCS-000479', actor: 'Ana R.', when: 'Today, 1:32 PM', balanceAfter: 20 },
    {
      type: 'TRANSFER_OUT',
      qty: -12,
      reference: 'TR-000228 to Cavite Branch',
      actor: 'Jun M.',
      when: 'Today, 9:05 AM',
      balanceAfter: 21,
    },
    {
      type: 'DAMAGE',
      qty: -1,
      reference: 'ADJ-000017, dropped in storage',
      actor: 'Jun M.',
      when: 'Yesterday, 5:40 PM',
      balanceAfter: 33,
    },
    {
      type: 'PURCHASE_RECEIPT',
      qty: 30,
      reference: 'PO-000112',
      actor: 'Jun M.',
      when: 'Fri, 10:20 AM',
      balanceAfter: 34,
    },
  ],
}
