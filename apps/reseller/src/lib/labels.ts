import type { ResellerOrder, ResellerReviewReason, ResellerStockStatus } from '@hcs/contracts'
import type { ChipTone } from '@hcs/ui'

export const stockLabel: Record<ResellerStockStatus, { text: string; tone: ChipTone }> = {
  in_stock: { text: 'In stock', tone: 'success' },
  low_stock: { text: 'Low stock', tone: 'warning' },
  out_of_stock: { text: 'Out of stock', tone: 'critical' },
}

export const orderStatusLabel: Record<ResellerOrder['status'], { text: string; tone: ChipTone }> = {
  submitted: { text: 'For review', tone: 'attention' },
  confirmed: { text: 'Confirmed', tone: 'info' },
  partially_fulfilled: { text: 'Partly released', tone: 'info' },
  fulfilled: { text: 'Released', tone: 'success' },
  cancelled: { text: 'Cancelled', tone: 'neutral' },
}

/** What the reseller sees while an order waits for review. */
export const reviewReasonLabel: Record<ResellerReviewReason, string> = {
  manual_review: 'The team will review your order before confirming it.',
  credit_settings_missing: 'The team is still setting up your payment terms and will review the order.',
  credit_review: 'The team needs to check your account before confirming.',
  stock_insufficient: 'Stock is short right now. The team will review when it can ship.',
  credit_limit: 'This order is over your available credit. The team will review it, or settle your balance first.',
}

export const paymentLabel = { gcash: 'GCash', bank_transfer: 'Bank transfer' } as const

export const paymentTermLabel = {
  prepaid: 'Prepaid',
  cod: 'Cash on delivery',
  net_7: 'Net 7 days',
  net_15: 'Net 15 days',
  net_30: 'Net 30 days',
} as const

const dateFormat = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date)
}
