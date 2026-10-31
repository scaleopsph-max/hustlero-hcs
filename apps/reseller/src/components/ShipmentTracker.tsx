'use client'

import type { ResellerOrder, ResellerShipment } from '@hcs/contracts'
import { cn, useToast } from '@hcs/ui'
import { Check, Copy } from 'lucide-react'

import { courierLabel, formatDateTime } from '@/lib/labels'

const order = ['to_pack', 'packed', 'shipped', 'delivered'] as const

/** Packing and delivery steps for a confirmed order, with the courier tracking number. */
export function ShipmentTracker({
  shipment,
  method,
}: {
  shipment: ResellerShipment
  method: ResellerOrder['fulfillmentMethod']
}) {
  const toast = useToast()
  const pickup = method === 'pickup'
  const steps = pickup
    ? [
        { id: 'to_pack', label: 'Packing', at: null },
        { id: 'packed', label: 'Ready for pickup', at: shipment.packedAt },
        { id: 'delivered', label: 'Picked up', at: shipment.deliveredAt },
      ]
    : [
        { id: 'to_pack', label: 'Packing', at: null },
        { id: 'packed', label: 'Packed', at: shipment.packedAt },
        { id: 'shipped', label: 'Shipped', at: shipment.shippedAt },
        { id: 'delivered', label: 'Delivered', at: shipment.deliveredAt },
      ]
  const current = order.indexOf(shipment.status)
  return (
    <div className="flex flex-col gap-3 rounded-control border border-white/10 p-3">
      <p className="text-small font-semibold">{pickup ? 'Pickup' : 'Delivery'}</p>
      <ol className="flex flex-col gap-2">
        {steps.map((step) => {
          const index = order.indexOf(step.id as (typeof order)[number])
          const done = index <= current
          return (
            <li key={step.id} className="flex items-center gap-3 text-small">
              <span
                className={cn(
                  'flex size-6 flex-none items-center justify-center rounded-full border',
                  done ? 'border-gold-500 bg-gold-500 text-ink-950' : 'border-white/20 text-ink-400',
                )}
              >
                {done ? <Check size={14} /> : null}
              </span>
              <span className={done ? 'font-semibold text-ink-50' : 'text-ink-400'}>{step.label}</span>
              {done && step.at ? (
                <span className="ml-auto text-caption text-ink-400">{formatDateTime(step.at)}</span>
              ) : null}
            </li>
          )
        })}
      </ol>
      {shipment.courier ? (
        <div className="flex items-center justify-between gap-3 rounded-control bg-white/5 px-3 py-2 text-small">
          <span className="min-w-0">
            <span className="block text-caption text-ink-400">{courierLabel[shipment.courier]}</span>
            <span className="block truncate font-semibold tracking-wide">
              {shipment.trackingNumber ?? 'No tracking number'}
            </span>
          </span>
          {shipment.trackingNumber ? (
            <button
              type="button"
              aria-label="Copy tracking number"
              className="flex size-9 flex-none items-center justify-center rounded-full border border-white/20 bg-white/5"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(shipment.trackingNumber ?? '')
                  .then(() => toast.success('Tracking number copied.'))
                  .catch(() => undefined)
              }}
            >
              <Copy size={16} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
