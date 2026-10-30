'use client'

import type { PortalCourier, PortalShipment, PortalShipmentStatus, PortalShipmentUpdateRequest } from '@hcs/contracts'
import { Button, Chip, Glass, cn, formatPeso } from '@hcs/ui'
import { Check, MapPin, Package, PackageCheck, Phone, Store, Truck } from 'lucide-react'
import { useState } from 'react'

const control =
  'min-h-10 w-full min-w-0 rounded-control border border-ink-900/15 bg-white px-3 text-sm outline-none focus:border-ink-900'

export const courierLabel: Record<PortalCourier, string> = { jnt: 'J&T Express', lalamove: 'Lalamove', other: 'Other' }

type Column = { id: 'to_pack' | 'packed' | 'shipped' | 'delivered'; title: string; hint: string }
const columns: Column[] = [
  { id: 'to_pack', title: 'To pack', hint: 'Confirmed and paid. Pick and pack these.' },
  { id: 'packed', title: 'Packed', hint: 'Ready to hand to the courier or for pickup.' },
  { id: 'shipped', title: 'Shipped', hint: 'With the courier. Mark delivered once received.' },
  { id: 'delivered', title: 'Delivered', hint: 'Delivered or picked up in the last 7 days.' },
]

const time = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('en-PH', {
        timeZone: 'Asia/Manila',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null

/** Packing and delivery for confirmed portal orders, one column per step. */
export function LogisticsBoard({
  shipments,
  busy,
  onUpdate,
}: {
  shipments: PortalShipment[]
  busy: string | null
  onUpdate: (shipment: PortalShipment, body: PortalShipmentUpdateRequest) => Promise<boolean>
}) {
  const [view, setView] = useState<Column['id']>('to_pack')
  const count = (status: PortalShipmentStatus) => shipments.filter((shipment) => shipment.status === status).length
  const shown = shipments.filter((shipment) => shipment.status === view)
  const column = columns.find((entry) => entry.id === view) ?? columns[0]!
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {columns.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={view === entry.id}
            onClick={() => setView(entry.id)}
            className={cn(
              'flex items-center justify-between gap-2 rounded-control border px-4 py-3 text-left',
              view === entry.id
                ? 'border-ink-900 bg-ink-900 text-white'
                : 'border-ink-900/10 bg-white/70 hover:bg-white',
            )}
          >
            <span className="text-sm font-semibold">{entry.title}</span>
            <span className="font-display text-h4">{count(entry.id)}</span>
          </button>
        ))}
      </div>
      <p className="text-sm text-ink-500">{column.hint}</p>
      {shown.length === 0 ? (
        <Glass variant="data" className="rounded-panel px-5 py-8 text-center text-sm text-ink-500">
          Nothing here right now.
        </Glass>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map((shipment) => (
            <ShipmentCard
              key={shipment.salesOrderId}
              shipment={shipment}
              busy={busy === `shipment:${shipment.salesOrderId}`}
              anyBusy={busy !== null}
              onUpdate={(body) => onUpdate(shipment, body)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ShipmentCard({
  shipment,
  busy,
  anyBusy,
  onUpdate,
}: {
  shipment: PortalShipment
  busy: boolean
  anyBusy: boolean
  onUpdate: (body: PortalShipmentUpdateRequest) => Promise<boolean>
}) {
  const [courier, setCourier] = useState<PortalCourier>('jnt')
  const [tracking, setTracking] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const pickup = shipment.method === 'pickup'
  return (
    <Glass variant="data" className="flex flex-col gap-3 rounded-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            {shipment.orderNumber} · {shipment.customerName}
          </p>
          <p className="text-sm text-ink-500">Confirmed {time(shipment.confirmedAt) ?? '—'}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Chip surface="light" tone={pickup ? 'info' : 'neutral'}>
            {pickup ? 'Pickup' : 'Delivery'}
          </Chip>
          <span className="text-sm font-semibold">{formatPeso(shipment.totalMinor)}</span>
        </div>
      </div>

      <ul className="flex flex-col gap-1 rounded-control bg-ink-900/[0.04] p-3 text-sm">
        {shipment.lines.map((line) => (
          <li key={`${line.sku}-${line.variantName}`} className="flex justify-between gap-3">
            <span className="min-w-0">
              {line.productName} {line.variantName} <span className="text-ink-500">{line.sku}</span>
            </span>
            <span className="flex-none font-semibold">× {line.quantityMilli / 1000}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-1 text-sm text-ink-700">
        <p className="flex items-start gap-2">
          {pickup ? (
            <Store size={16} className="mt-0.5 flex-none" />
          ) : (
            <MapPin size={16} className="mt-0.5 flex-none" />
          )}
          {pickup ? `Pickup at ${shipment.locationName}` : (shipment.deliveryAddress ?? 'No address')}
        </p>
        {shipment.customerPhone ? (
          <p className="flex items-center gap-2">
            <Phone size={16} className="flex-none" />
            <a className="underline-offset-2 hover:underline" href={`tel:${shipment.customerPhone}`}>
              {shipment.customerPhone}
            </a>
          </p>
        ) : null}
        {shipment.courier ? (
          <p className="flex items-center gap-2">
            <Truck size={16} className="flex-none" />
            {courierLabel[shipment.courier]}
            {shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ''}
            {shipment.shippedAt ? <span className="text-ink-500">· {time(shipment.shippedAt)}</span> : null}
          </p>
        ) : null}
        {shipment.deliveredAt ? (
          <p className="flex items-center gap-2 text-signal-light-success-fg">
            <Check size={16} className="flex-none" />
            {pickup ? 'Picked up' : 'Delivered'} {time(shipment.deliveredAt)}
          </p>
        ) : null}
      </div>

      {shipment.status === 'to_pack' ? (
        <Button variant="confirm" disabled={anyBusy} onClick={() => void onUpdate({ status: 'packed' })}>
          <Package size={16} className="mr-2" />
          {busy ? 'Saving…' : pickup ? 'Mark packed (ready for pickup)' : 'Mark packed'}
        </Button>
      ) : null}

      {shipment.status === 'packed' && pickup ? (
        <Button variant="confirm" disabled={anyBusy} onClick={() => void onUpdate({ status: 'delivered' })}>
          <PackageCheck size={16} className="mr-2" />
          {busy ? 'Saving…' : 'Mark picked up'}
        </Button>
      ) : null}

      {shipment.status === 'packed' && !pickup ? (
        <form
          className="grid gap-3 sm:grid-cols-[auto,1fr,auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmed = tracking.trim()
            if (courier === 'jnt' && trimmed.length < 3) return setProblem('Enter the J&T tracking number.')
            setProblem(null)
            void onUpdate({
              status: 'shipped',
              courier,
              ...(trimmed.length >= 3 ? { trackingNumber: trimmed } : {}),
            }).then((saved) => {
              if (saved) setTracking('')
            })
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Courier
            <select
              className={control}
              value={courier}
              onChange={(event) => setCourier(event.target.value as PortalCourier)}
            >
              <option value="jnt">J&amp;T Express</option>
              <option value="lalamove">Lalamove</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            {courier === 'lalamove' ? 'Booking ID (optional)' : 'Tracking number'}
            <input
              className={control}
              maxLength={80}
              value={tracking}
              onChange={(event) => setTracking(event.target.value)}
              placeholder={courier === 'jnt' ? 'e.g. JT0012345678' : ''}
            />
          </label>
          <Button type="submit" variant="confirm" disabled={anyBusy}>
            <Truck size={16} className="mr-2" />
            {busy ? 'Saving…' : 'Mark shipped'}
          </Button>
          {problem ? <p className="text-sm text-signal-light-critical-fg sm:col-span-3">{problem}</p> : null}
        </form>
      ) : null}

      {shipment.status === 'shipped' ? (
        <Button variant="confirm" disabled={anyBusy} onClick={() => void onUpdate({ status: 'delivered' })}>
          <PackageCheck size={16} className="mr-2" />
          {busy ? 'Saving…' : 'Mark delivered'}
        </Button>
      ) : null}
    </Glass>
  )
}
