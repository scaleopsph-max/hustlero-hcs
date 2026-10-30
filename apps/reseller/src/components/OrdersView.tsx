'use client'

import type { ResellerOrder, ResellerPaymentAccount } from '@hcs/contracts'
import { Button, Chip, Glass, formatPeso } from '@hcs/ui'
import { ChevronDown, PackageSearch, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'

import { formatQuantity } from '@/lib/cart'
import { PaymentProofs } from './PaymentProofs'
import { formatDateTime, formatTime, orderBadge, paymentLabel, reviewReasonLabel, timeLeft } from '@/lib/labels'
import { PaymentInstructions } from './PaymentInstructions'

export function OrdersView({
  orders,
  loading,
  onRefresh,
  onReorder,
  onUploadProof,
  focusOrderId,
  paymentInstructions,
  paymentAccounts,
}: {
  orders: ResellerOrder[]
  /** Order to open on arrival, e.g. right after checkout. */
  focusOrderId?: string | null
  paymentInstructions?: string | null
  paymentAccounts?: ResellerPaymentAccount[] | undefined
  loading: boolean
  onRefresh: () => void
  onReorder: (order: ResellerOrder) => void
  onUploadProof: (orderId: string, body: FormData, idempotencyKey: string) => Promise<void>
}) {
  const [openId, setOpenId] = useState<string | null>(focusOrderId ?? null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (focusOrderId) setOpenId(focusOrderId)
  }, [focusOrderId])
  // Keeps the payment countdown current.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-h3">Orders</h1>
        <Button size="sm" onClick={onRefresh} disabled={loading} aria-label="Refresh orders">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      {orders.length === 0 ? (
        <Glass className="flex flex-col items-center gap-3 rounded-sheet px-6 py-12 text-center">
          <PackageSearch size={40} className="text-ink-300" />
          <p className="text-ink-200">{loading ? 'Loading orders…' : 'You have no orders yet.'}</p>
        </Glass>
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map((order) => {
            const status = orderBadge(order)
            const awaitingPayment = order.status === 'submitted' && order.reviewReason === 'awaiting_payment'
            const left = awaitingPayment && order.paymentDueAt ? timeLeft(order.paymentDueAt, now) : null
            const open = openId === order.id
            return (
              <li key={order.id}>
                <Glass className="rounded-glass">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 p-4 text-left"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : order.id)}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold">{order.orderNumber}</p>
                      <p className="text-small text-ink-300">
                        {formatDateTime(order.createdAt)} · {order.lines.length}{' '}
                        {order.lines.length === 1 ? 'item' : 'items'}
                      </p>
                    </div>
                    <div className="flex flex-none flex-col items-end gap-1.5">
                      <Chip tone={status.tone}>{status.text}</Chip>
                      <span className="text-small font-semibold">{formatPeso(order.totalMinor)}</span>
                    </div>
                    <ChevronDown size={18} className={open ? 'flex-none rotate-180' : 'flex-none'} />
                  </button>

                  {open ? (
                    <div className="flex flex-col gap-3 border-t border-white/10 p-4">
                      {awaitingPayment && order.paymentDueAt ? (
                        <div className="flex flex-col gap-2">
                          <p className="rounded-control bg-signal-dark-attention-bg px-3 py-2 text-small text-signal-dark-attention-fg">
                            {left
                              ? `Pay by ${formatTime(order.paymentDueAt)} (${left}). Upload your proof before then or the order is cancelled.`
                              : 'The payment window has closed. Refresh to see the latest status.'}
                          </p>
                          <PaymentInstructions
                            accounts={paymentAccounts}
                            instructions={paymentInstructions}
                            defaultMethod={order.paymentPreference}
                          />
                        </div>
                      ) : order.status === 'submitted' && order.reviewReason ? (
                        <p className="rounded-control bg-signal-dark-attention-bg px-3 py-2 text-small text-signal-dark-attention-fg">
                          {reviewReasonLabel[order.reviewReason]}
                        </p>
                      ) : null}
                      {order.status === 'cancelled' && order.reviewDecisionReason ? (
                        <p className="rounded-control bg-white/10 px-3 py-2 text-small text-ink-200">
                          Reason: {order.reviewDecisionReason}
                        </p>
                      ) : null}
                      <ul className="flex flex-col gap-2">
                        {order.lines.map((line) => (
                          <li key={line.id} className="flex justify-between gap-3 text-small">
                            <span className="min-w-0">
                              {formatQuantity(line.orderedQuantityMilli)} × {line.productName} {line.variantName}
                              {line.fulfilledQuantityMilli > 0 &&
                              line.fulfilledQuantityMilli < line.orderedQuantityMilli ? (
                                <span className="block text-ink-400">
                                  {formatQuantity(line.fulfilledQuantityMilli)} released so far
                                </span>
                              ) : null}
                            </span>
                            <span className="flex-none font-semibold">{formatPeso(line.lineTotalMinor)}</span>
                          </li>
                        ))}
                      </ul>
                      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-small text-ink-300">
                        <dt>Fulfillment</dt>
                        <dd className="text-ink-100">
                          {order.fulfillmentMethod === 'pickup'
                            ? `Pickup at ${order.locationName}`
                            : (order.deliveryAddress ?? 'Delivery')}
                        </dd>
                        {order.paymentPreference ? (
                          <>
                            <dt>Payment</dt>
                            <dd className="text-ink-100">{paymentLabel[order.paymentPreference]}</dd>
                          </>
                        ) : null}
                        {order.invoices.length > 0 ? (
                          <>
                            <dt>Invoice</dt>
                            <dd className="text-ink-100">
                              {order.invoices.map((invoice) => invoice.invoiceNumber).join(', ')}
                            </dd>
                          </>
                        ) : null}
                      </dl>
                      <PaymentProofs
                        order={order}
                        onUpload={onUploadProof}
                        startOpen={awaitingPayment && left !== null}
                      />
                      <Button size="sm" onClick={() => onReorder(order)}>
                        Order again
                      </Button>
                    </div>
                  ) : null}
                </Glass>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
