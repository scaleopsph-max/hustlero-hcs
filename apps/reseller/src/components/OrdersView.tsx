'use client'

import type { ResellerOrder } from '@hcs/contracts'
import { Button, Chip, Glass, formatPeso } from '@hcs/ui'
import { ChevronDown, PackageSearch, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { formatQuantity } from '@/lib/cart'
import { PaymentProofs } from './PaymentProofs'
import { formatDateTime, orderStatusLabel, paymentLabel, reviewReasonLabel } from '@/lib/labels'

export function OrdersView({
  orders,
  loading,
  onRefresh,
  onReorder,
  onUploadProof,
}: {
  orders: ResellerOrder[]
  loading: boolean
  onRefresh: () => void
  onReorder: (order: ResellerOrder) => void
  onUploadProof: (orderId: string, body: FormData, idempotencyKey: string) => Promise<void>
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-h3">Mga order</h1>
        <Button size="sm" onClick={onRefresh} disabled={loading} aria-label="I-refresh ang orders">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      {orders.length === 0 ? (
        <Glass className="flex flex-col items-center gap-3 rounded-sheet px-6 py-12 text-center">
          <PackageSearch size={40} className="text-ink-300" />
          <p className="text-ink-200">{loading ? 'Kinukuha ang orders…' : 'Wala ka pang order.'}</p>
        </Glass>
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map((order) => {
            const status = orderStatusLabel[order.status]
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
                        {formatDateTime(order.createdAt)} · {order.lines.length} item
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
                      {order.status === 'submitted' && order.reviewReason ? (
                        <p className="rounded-control bg-signal-dark-attention-bg px-3 py-2 text-small text-signal-dark-attention-fg">
                          {reviewReasonLabel[order.reviewReason]}
                        </p>
                      ) : null}
                      {order.status === 'cancelled' && order.reviewDecisionReason ? (
                        <p className="rounded-control bg-white/10 px-3 py-2 text-small text-ink-200">
                          Dahilan: {order.reviewDecisionReason}
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
                                  {formatQuantity(line.fulfilledQuantityMilli)} na ang na-release
                                </span>
                              ) : null}
                            </span>
                            <span className="flex-none font-semibold">{formatPeso(line.lineTotalMinor)}</span>
                          </li>
                        ))}
                      </ul>
                      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-small text-ink-300">
                        <dt>Kukunin</dt>
                        <dd className="text-ink-100">
                          {order.fulfillmentMethod === 'pickup'
                            ? `Pickup sa ${order.locationName}`
                            : (order.deliveryAddress ?? 'Delivery')}
                        </dd>
                        {order.paymentPreference ? (
                          <>
                            <dt>Bayad</dt>
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
                      <PaymentProofs order={order} onUpload={onUploadProof} />
                      <Button size="sm" onClick={() => onReorder(order)}>
                        Order ulit
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
