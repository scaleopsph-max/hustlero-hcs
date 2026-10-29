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
  manual_review: 'Ire-review muna ng team ang order mo bago i-confirm.',
  credit_settings_missing: 'Inaayos pa ng team ang payment terms mo. Ire-review nila ang order.',
  credit_review: 'Kailangang i-check ng team ang account mo bago i-confirm.',
  stock_insufficient: 'Kulang ang stock sa ngayon. Ire-review ng team kung kailan ito maipapadala.',
  credit_limit: 'Lagpas ang order sa available credit mo. Ire-review ng team o mag-settle muna ng balance.',
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
