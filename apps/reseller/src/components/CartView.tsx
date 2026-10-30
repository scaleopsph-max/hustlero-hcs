'use client'

import type { ResellerOrderSubmitRequest, ResellerOrderSubmitResponse, ResellerPortalCatalog } from '@hcs/contracts'
import { Button, Glass, cn, formatPeso } from '@hcs/ui'
import { CircleCheck, Clock, ShoppingCart, TriangleAlert } from 'lucide-react'
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { formatQuantity, summarizeCart, type CartLine } from '@/lib/cart'
import { paymentLabel, reviewReasonLabel, stockLabel } from '@/lib/labels'
import { newIdempotencyKey } from '@/lib/portal-api'

import { QuantityStepper } from './QuantityStepper'

export function CartView({
  catalog,
  cart,
  onQuantity,
  onSubmit,
  onOrderPlaced,
  onBrowse,
}: {
  catalog: ResellerPortalCatalog
  cart: CartLine[]
  onQuantity: (variantId: string, quantityMilli: number) => void
  onSubmit: (request: ResellerOrderSubmitRequest, idempotencyKey: string) => Promise<ResellerOrderSubmitResponse>
  onOrderPlaced: () => void
  onBrowse: () => void
}) {
  const summary = useMemo(() => summarizeCart(cart, catalog.items), [cart, catalog.items])
  const [method, setMethod] = useState<'delivery' | 'pickup'>('delivery')
  const [address, setAddress] = useState('')
  const [payment, setPayment] = useState<'gcash' | 'bank_transfer'>('gcash')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [placed, setPlaced] = useState<ResellerOrderSubmitResponse | null>(null)
  // One key per attempted order; kept across retries so a lost response never doubles the order.
  const attempt = useRef<{ key: string; fingerprint: string } | null>(null)

  if (placed) {
    const confirmed = placed.status === 'confirmed'
    return (
      <Glass className="flex flex-col items-center gap-4 rounded-sheet px-6 py-10 text-center">
        {confirmed ? (
          <CircleCheck size={48} className="text-signal-dark-success-fg" />
        ) : (
          <Clock size={48} className="text-signal-dark-attention-fg" />
        )}
        <div>
          <p className="text-h3">{confirmed ? 'Order confirmed!' : 'Order received'}</p>
          <p className="mt-1 text-ink-300">
            Order {placed.orderNumber} · {formatPeso(placed.totalMinor)}
          </p>
        </div>
        <p className="text-ink-200">
          {confirmed
            ? 'Your stock is reserved. Watch for updates on payment and delivery.'
            : placed.reviewReason
              ? reviewReasonLabel[placed.reviewReason]
              : 'The team will review your order first.'}
        </p>
        <Button
          variant="primary"
          onClick={() => {
            setPlaced(null)
            onOrderPlaced()
          }}
        >
          View orders
        </Button>
      </Glass>
    )
  }

  if (summary.rows.length === 0) {
    return (
      <Glass className="flex flex-col items-center gap-4 rounded-sheet px-6 py-12 text-center">
        <ShoppingCart size={40} className="text-ink-300" />
        <p className="text-h4">Your cart is empty</p>
        <Button variant="primary" onClick={onBrowse}>
          Browse products
        </Button>
      </Glass>
    )
  }

  const deliveryMissing = method === 'delivery' && address.trim().length < 5
  const blocked = summary.shortfalls.length > 0 || deliveryMissing || busy

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (blocked) return
    const request: ResellerOrderSubmitRequest = {
      lines: summary.rows.map(({ variantId, quantityMilli }) => ({ variantId, quantityMilli })),
      fulfillmentMethod: method,
      paymentPreference: payment,
      ...(method === 'delivery' ? { deliveryAddress: address.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    }
    const fingerprint = JSON.stringify(request)
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { key: newIdempotencyKey('rp'), fingerprint }
    setBusy(true)
    setError(null)
    try {
      setPlaced(await onSubmit(request, attempt.current.key))
      attempt.current = null
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'The order was not sent. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <ul className="flex flex-col gap-3">
        {summary.rows.map((row) => {
          const label = `${row.item.productName} ${row.item.variantName}`
          return (
            <li key={row.variantId}>
              <Glass className="flex flex-col gap-3 rounded-glass p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold leading-tight">{row.item.productName}</p>
                    <p className="text-small text-ink-300">
                      {row.item.variantName} · {formatPeso(row.item.unitPriceMinor)} each
                    </p>
                    {row.item.stockStatus !== 'in_stock' ? (
                      <p className="text-caption text-signal-dark-warning-fg">
                        {stockLabel[row.item.stockStatus].text}
                      </p>
                    ) : null}
                  </div>
                  <p className="font-semibold">{formatPeso(row.lineTotalMinor)}</p>
                </div>
                <QuantityStepper
                  label={label}
                  quantityMilli={row.quantityMilli}
                  onChange={(quantityMilli) => onQuantity(row.variantId, quantityMilli)}
                />
              </Glass>
            </li>
          )
        })}
      </ul>

      {summary.missingVariantIds.length > 0 ? (
        <Notice>{summary.missingVariantIds.length} item(s) are no longer available and will not be included.</Notice>
      ) : null}
      {summary.shortfalls.map((shortfall) => (
        <Notice key={shortfall.pricingGroupId}>
          Add {formatQuantity(shortfall.neededMilli)} more pcs of {shortfall.pricingGroupName} to get the wholesale
          price.
        </Notice>
      ))}
      {summary.hasOutOfStock ? (
        <Notice>Some items are out of stock. You can still submit; the team will review the order.</Notice>
      ) : null}

      <Glass className="flex flex-col gap-4 rounded-glass p-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-small font-semibold">How will you get it?</legend>
          <div className="grid grid-cols-2 gap-2">
            <Choice selected={method === 'delivery'} onSelect={() => setMethod('delivery')} name="method">
              Delivery
            </Choice>
            <Choice selected={method === 'pickup'} onSelect={() => setMethod('pickup')} name="method">
              Pickup at {catalog.fulfillmentLocationName}
            </Choice>
          </div>
        </fieldset>
        {method === 'delivery' ? (
          <label className="flex flex-col gap-2">
            <span className="text-small font-semibold">Delivery address</span>
            <textarea
              className="field h-auto min-h-24 py-3"
              maxLength={500}
              required
              value={address}
              autoComplete="street-address"
              onChange={(event) => setAddress(event.target.value)}
              placeholder="House no., street, barangay, city"
            />
          </label>
        ) : null}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-small font-semibold">Payment method</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['gcash', 'bank_transfer'] as const).map((option) => (
              <Choice key={option} selected={payment === option} onSelect={() => setPayment(option)} name="payment">
                {paymentLabel[option]}
              </Choice>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-2">
          <span className="text-small font-semibold">Notes (optional)</span>
          <input className="field" maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
      </Glass>

      <Glass variant="strong" className="flex flex-col gap-3 rounded-sheet p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-ink-300">
            Total ({summary.itemCount} {summary.itemCount === 1 ? 'item' : 'items'})
          </span>
          <span className="text-pos-price">{formatPeso(summary.totalMinor)}</span>
        </div>
        {summary.potentialProfitMinor > 0 ? (
          <p className="text-small text-signal-dark-success-fg">
            Estimated profit if sold at SRP: {formatPeso(summary.potentialProfitMinor)}
          </p>
        ) : null}
        {error ? <p className="text-small text-signal-dark-critical-fg">{error}</p> : null}
        <Button type="submit" variant="primary" size="xl" disabled={blocked}>
          {busy ? 'Sending…' : 'Submit order'}
        </Button>
      </Glass>
    </form>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-control bg-signal-dark-attention-bg px-3 py-2.5 text-small text-signal-dark-attention-fg">
      <TriangleAlert size={16} className="mt-0.5 flex-none" />
      {children}
    </p>
  )
}

function Choice({
  selected,
  onSelect,
  name,
  children,
}: {
  selected: boolean
  onSelect: () => void
  name: string
  children: ReactNode
}) {
  return (
    <label
      className={cn(
        'flex min-h-touch cursor-pointer items-center justify-center rounded-control border px-3 py-2 text-center text-small font-semibold',
        selected ? 'border-gold-500 bg-gold-500/15 text-gold-200' : 'border-white/20 bg-white/5',
      )}
    >
      <input type="radio" name={name} className="sr-only" checked={selected} onChange={onSelect} />
      {children}
    </label>
  )
}
