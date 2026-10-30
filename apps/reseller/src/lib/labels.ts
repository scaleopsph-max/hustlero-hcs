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
  awaiting_payment: 'Send your payment and upload the proof to keep your stock on hold.',
  payment_review: 'Payment proof received. The team is checking it and will confirm your order soon.',
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

/** The badge for an order: pay-first orders show where they are in the payment step. */
export function orderBadge(
  order: Pick<ResellerOrder, 'status' | 'reviewReason'> &
    Partial<Pick<ResellerOrder, 'shipment' | 'fulfillmentMethod'>>,
): {
  text: string
  tone: ChipTone
} {
  if (order.status !== 'cancelled' && order.shipment) {
    const pickup = order.fulfillmentMethod === 'pickup'
    switch (order.shipment.status) {
      case 'to_pack':
        return { text: 'Packing', tone: 'info' }
      case 'packed':
        return pickup ? { text: 'Ready for pickup', tone: 'attention' } : { text: 'Packed', tone: 'info' }
      case 'shipped':
        return { text: 'Shipped', tone: 'info' }
      case 'delivered':
        return { text: pickup ? 'Picked up' : 'Delivered', tone: 'success' }
    }
  }
  if (order.status === 'submitted' && order.reviewReason === 'awaiting_payment')
    return { text: 'Awaiting payment', tone: 'attention' }
  if (order.status === 'submitted' && order.reviewReason === 'payment_review')
    return { text: 'Payment sent', tone: 'info' }
  return orderStatusLabel[order.status]
}

const timeFormat = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })

/** "8:31 PM" for a payment deadline. */
export function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : timeFormat.format(date)
}

/** "3h 52m left", "12m left", or null once the deadline has passed. */
export function timeLeft(deadline: string, now: number): string | null {
  const ms = new Date(deadline).getTime() - now
  if (Number.isNaN(ms) || ms <= 0) return null
  const minutes = Math.ceil(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m left` : `${minutes}m left`
}

export const courierLabel = { jnt: 'J&T Express', lalamove: 'Lalamove', other: 'Courier' } as const
