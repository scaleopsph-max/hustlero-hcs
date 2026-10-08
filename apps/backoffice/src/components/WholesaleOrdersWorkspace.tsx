'use client'

import { selectActiveTenant } from '@/lib/active-tenant'
import { createClient } from '@/lib/supabase-browser'
import { nextWholesaleOrderNumber } from '@/lib/wholesale-order-number'
import {
  sessionContextResponseSchema,
  wholesaleOrderCancelResponseSchema,
  wholesaleOrderConfirmResponseSchema,
  wholesaleOrderContextSchema,
  wholesaleOrderDraftResponseSchema,
  wholesaleOrderFulfillResponseSchema,
  type WholesaleOrderContext,
} from '@hcs/contracts'
import { Button, Chip, Glass, formatPeso } from '@hcs/ui'
import { Ban, Check, FilePlus2, PackageCheck, Printer, Save, ShoppingCart } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

const apiUrl = process.env.NEXT_PUBLIC_API_URL
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

async function call(path: string, token: string, tenantId: string, options: RequestInit = {}) {
  if (!apiUrl) throw new Error('Back Office API URL is not configured.')
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenantId, ...options.headers },
  })
  const data: unknown = await response.json()
  if (!response.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? 'Request failed.')
  return data
}

const quantityText = (milli: number) => (milli % 1000 === 0 ? String(milli / 1000) : (milli / 1000).toFixed(3))

export function WholesaleOrdersWorkspace() {
  const [auth] = useState(() => (supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null))
  const [token, setToken] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [data, setData] = useState<WholesaleOrderContext | null>(null)
  const [editingId, setEditingId] = useState<string | undefined>()
  const [orderNumber, setOrderNumber] = useState(() => nextWholesaleOrderNumber([]))
  const [customerId, setCustomerId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [priceListId, setPriceListId] = useState('')
  const [notes, setNotes] = useState('')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [fulfillmentQuantities, setFulfillmentQuantities] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async (nextToken: string, nextTenant: string) => {
    const context = wholesaleOrderContextSchema.parse(await call('/v1/wholesale/orders', nextToken, nextTenant))
    setData(context)
    setSelectedOrderId((current) => current ?? context.orders[0]?.id ?? null)
    setCustomerId((current) => current || context.customers[0]?.id || '')
    setLocationId((current) => current || context.locations[0]?.id || '')
    return context
  }, [])

  useEffect(() => {
    if (!auth) {
      setError('Back Office authentication is not configured.')
      setLoading(false)
      return
    }
    void auth.auth.getSession().then(async ({ data: sessionData, error: sessionError }) => {
      try {
        if (sessionError) throw sessionError
        if (!sessionData.session) throw new Error('Sign in to manage wholesale orders.')
        const nextToken = sessionData.session.access_token
        const session = sessionContextResponseSchema.parse(await call('/v1/me', nextToken, ''))
        const tenant = selectActiveTenant(session.tenants)
        if (!tenant) throw new Error('Create or select a business first.')
        setToken(nextToken)
        setTenantId(tenant.tenantId)
        const context = await load(nextToken, tenant.tenantId)
        setOrderNumber(nextWholesaleOrderNumber(context.orders.map((order) => order.orderNumber)))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load wholesale orders.')
      } finally {
        setLoading(false)
      }
    })
  }, [auth, load])

  const eligiblePriceLists = useMemo(
    () =>
      data?.priceLists.filter(
        (list) => list.isDefault || (customerId !== '' && list.customerIds.includes(customerId)),
      ) ?? [],
    [customerId, data],
  )
  const selectedPriceList = eligiblePriceLists.find((list) => list.id === priceListId) ?? eligiblePriceLists[0]
  const selectedOrder = data?.orders.find((order) => order.id === selectedOrderId) ?? null
  const linePreview = useMemo(() => {
    if (!data || !selectedPriceList) return []
    return selectedPriceList.entries.flatMap((entry) => {
      const raw = quantities[entry.variantId]
      const quantityMilli = Math.round(Number(raw) * 1000)
      if (!raw || !Number.isFinite(quantityMilli) || quantityMilli <= 0) return []
      const variant = data.variants.find((item) => item.id === entry.variantId)
      return variant
        ? [{ ...entry, ...variant, quantityMilli, lineTotalMinor: (quantityMilli / 1000) * entry.unitPriceMinor }]
        : []
    })
  }, [data, quantities, selectedPriceList])
  const totalMinor = linePreview.reduce((sum, line) => sum + line.lineTotalMinor, 0)

  function resetDraft(orders = data?.orders ?? []) {
    setEditingId(undefined)
    setOrderNumber(nextWholesaleOrderNumber(orders.map((order) => order.orderNumber)))
    setNotes('')
    setQuantities({})
  }

  function editDraft(order: WholesaleOrderContext['orders'][number]) {
    setSelectedOrderId(order.id)
    if (order.status !== 'draft') return
    setEditingId(order.id)
    setOrderNumber(order.orderNumber)
    setCustomerId(order.customerId)
    setLocationId(order.locationId)
    setPriceListId(order.priceListId)
    setNotes(order.notes ?? '')
    setQuantities(
      Object.fromEntries(order.lines.map((line) => [line.variantId, quantityText(line.orderedQuantityMilli)])),
    )
    setMessage(null)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!token || !tenantId || !selectedPriceList || !linePreview.length) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = wholesaleOrderDraftResponseSchema.parse(
        await call('/v1/wholesale/orders', token, tenantId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `wholesale-save-${crypto.randomUUID()}` },
          body: JSON.stringify({
            id: editingId,
            orderNumber,
            customerId,
            locationId,
            priceListId: selectedPriceList.id,
            pricingType: selectedPriceList.pricingType,
            notes: notes || null,
            lines: linePreview.map((line) => ({ variantId: line.variantId, quantityMilli: line.quantityMilli })),
          }),
        }),
      )
      const context = await load(token, tenantId)
      setSelectedOrderId(response.salesOrderId)
      setMessage(response.result === 'created' ? 'Draft order created.' : 'Draft order updated.')
      resetDraft(context.orders)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the draft order.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmOrder() {
    if (!token || !tenantId || !selectedOrder || selectedOrder.status !== 'draft') return
    setBusy(true)
    setError(null)
    try {
      wholesaleOrderConfirmResponseSchema.parse(
        await call(`/v1/wholesale/orders/${selectedOrder.id}/confirm`, token, tenantId, {
          method: 'POST',
          headers: { 'Idempotency-Key': `wholesale-confirm-${crypto.randomUUID()}` },
        }),
      )
      await load(token, tenantId)
      setMessage('Order confirmed and shared inventory reserved.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not confirm the order.')
    } finally {
      setBusy(false)
    }
  }

  async function cancelOrder() {
    if (!token || !tenantId || !selectedOrder || !cancelReason.trim()) return
    setBusy(true)
    setError(null)
    try {
      wholesaleOrderCancelResponseSchema.parse(
        await call(`/v1/wholesale/orders/${selectedOrder.id}/cancel`, token, tenantId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `wholesale-cancel-${crypto.randomUUID()}` },
          body: JSON.stringify({ reason: cancelReason }),
        }),
      )
      await load(token, tenantId)
      setCancelReason('')
      setMessage('Order cancelled and the remaining reservation released.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not cancel the order.')
    } finally {
      setBusy(false)
    }
  }

  async function fulfillOrder() {
    if (!token || !tenantId || !selectedOrder) return
    const lines = selectedOrder.lines
      .map((line) => ({
        salesOrderLineId: line.id,
        quantityMilli: Math.round(Number(fulfillmentQuantities[line.id] ?? 0) * 1000),
      }))
      .filter((line) => Number.isInteger(line.quantityMilli) && line.quantityMilli > 0)
    if (!lines.length) {
      setError('Enter at least one fulfillment quantity.')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = wholesaleOrderFulfillResponseSchema.parse(
        await call(`/v1/wholesale/orders/${selectedOrder.id}/fulfill`, token, tenantId, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `wholesale-fulfill-${crypto.randomUUID()}`,
          },
          body: JSON.stringify({ lines }),
        }),
      )
      setFulfillmentQuantities({})
      await load(token, tenantId)
      setMessage(`Invoice ${response.invoiceNumber} issued for ${formatPeso(response.totalMinor)}.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not fulfill the order.')
    } finally {
      setBusy(false)
    }
  }

  if (loading)
    return (
      <Glass variant="light" className="p-8 text-sm text-ink-500">
        Loading wholesale orders...
      </Glass>
    )
  if (!data) return <div className="border-l-2 border-red-600 bg-red-50 p-4 text-sm text-red-800">{error}</div>

  return (
    <div className="grid gap-4">
      {error ? <div className="border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {message ? (
        <div className="border-l-2 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.72fr)_minmax(0,1.28fr)]">
        <Glass variant="light" className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-ink-900/10 p-5">
            <div>
              <h2 className="font-display text-xl font-bold">Sales orders</h2>
              <p className="mt-1 text-sm text-ink-500">{data.orders.length} orders</p>
            </div>
            <button
              type="button"
              title="New draft"
              onClick={() => resetDraft()}
              className="grid size-10 place-items-center border border-ink-900/15 bg-white hover:bg-ink-900/[0.04]"
            >
              <FilePlus2 size={19} />
            </button>
          </div>
          {data.orders.length ? (
            data.orders.map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => editDraft(order)}
                className={`grid w-full gap-2 border-b border-ink-900/10 p-5 text-left ${selectedOrderId === order.id ? 'bg-gold-500/10' : 'hover:bg-ink-900/[0.03]'}`}
              >
                <span className="flex items-center justify-between gap-3">
                  <strong>{order.orderNumber}</strong>
                  <Chip
                    tone={
                      order.status === 'confirmed' ? 'success' : order.status === 'cancelled' ? 'neutral' : 'warning'
                    }
                  >
                    {order.status.replaceAll('_', ' ')}
                  </Chip>
                </span>
                <span className="text-sm text-ink-500">
                  {order.customerName} · {order.locationName}
                </span>
                <span className="font-semibold">{formatPeso(order.totalMinor)}</span>
              </button>
            ))
          ) : (
            <p className="p-5 text-sm text-ink-500">No wholesale sales orders yet.</p>
          )}
        </Glass>

        <div className="grid content-start gap-4">
          {selectedOrder ? (
            <Glass variant="data" className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase text-ink-500">Selected order</p>
                  <h2 className="mt-1 font-display text-xl font-bold">{selectedOrder.orderNumber}</h2>
                  <p className="mt-1 text-sm text-ink-500">
                    {selectedOrder.customerName} · {selectedOrder.locationName}
                  </p>
                </div>
                <strong className="text-xl">{formatPeso(selectedOrder.totalMinor)}</strong>
              </div>
              <div className="mt-4 divide-y divide-ink-900/10 border-y border-ink-900/10">
                {selectedOrder.lines.map((line) => (
                  <div key={line.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-3 text-sm">
                    <span>
                      <strong className="block">
                        {line.productName} / {line.variantName}
                      </strong>
                      <span className="text-ink-500">
                        {line.sku} · {quantityText(line.orderedQuantityMilli)} × {formatPeso(line.unitPriceMinor)}
                      </span>
                    </span>
                    <strong>{formatPeso(line.lineTotalMinor)}</strong>
                  </div>
                ))}
              </div>
              {selectedOrder.status === 'draft' ? (
                <Button className="mt-4" disabled={!data.canManage || busy} onClick={confirmOrder}>
                  <Check size={18} /> Confirm and reserve
                </Button>
              ) : selectedOrder.status === 'confirmed' || selectedOrder.status === 'partially_fulfilled' ? (
                <div className="mt-4 grid gap-4">
                  <div className="border border-ink-900/10 bg-white">
                    <div className="border-b border-ink-900/10 px-4 py-3">
                      <strong className="text-sm">Fulfill reserved items</strong>
                      <p className="mt-1 text-xs text-ink-500">Each fulfillment creates one immutable invoice.</p>
                    </div>
                    {selectedOrder.lines.map((line) => {
                      const remaining =
                        line.orderedQuantityMilli - line.fulfilledQuantityMilli - line.cancelledQuantityMilli
                      if (remaining <= 0) return null
                      return (
                        <label
                          key={line.id}
                          className="grid grid-cols-[minmax(0,1fr)_110px] items-center gap-3 border-b border-ink-900/10 p-3 text-sm last:border-0"
                        >
                          <span>
                            <strong className="block">
                              {line.productName} / {line.variantName}
                            </strong>
                            <span className="text-xs text-ink-500">{quantityText(remaining)} remaining</span>
                          </span>
                          <input
                            inputMode="decimal"
                            aria-label={`${line.productName} fulfillment quantity`}
                            value={fulfillmentQuantities[line.id] ?? ''}
                            onChange={(event) =>
                              setFulfillmentQuantities((current) => ({
                                ...current,
                                [line.id]: event.target.value.replace(/[^0-9.]/g, ''),
                              }))
                            }
                            placeholder="Qty"
                            className="min-h-10 border border-ink-900/15 bg-white px-3 text-right"
                          />
                        </label>
                      )
                    })}
                    <div className="flex justify-end p-3">
                      <Button disabled={!data.canManage || busy} onClick={fulfillOrder}>
                        <PackageCheck size={18} /> Issue invoice
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <input
                      value={cancelReason}
                      onChange={(event) => setCancelReason(event.target.value)}
                      placeholder="Cancellation reason"
                      maxLength={500}
                      className="min-h-11 border border-ink-900/15 bg-white px-3"
                    />
                    <Button
                      variant="secondary"
                      disabled={!data.canManage || busy || cancelReason.trim().length < 2}
                      onClick={cancelOrder}
                    >
                      <Ban size={18} /> Cancel remainder
                    </Button>
                  </div>
                </div>
              ) : null}
              {data.invoices.some((invoice) => invoice.salesOrderId === selectedOrder.id) ? (
                <div className="mt-5 border-t border-ink-900/10 pt-4">
                  <h3 className="text-sm font-semibold">Invoices</h3>
                  <div className="mt-2 grid gap-2">
                    {data.invoices
                      .filter((invoice) => invoice.salesOrderId === selectedOrder.id)
                      .map((invoice) => (
                        <Link
                          key={invoice.id}
                          href={`/sales/${invoice.saleId}`}
                          className="flex items-center justify-between gap-3 border border-ink-900/10 bg-white px-3 py-2 text-sm hover:bg-ink-900/[0.03]"
                        >
                          <span>
                            <strong>{invoice.invoiceNumber}</strong>
                            <span className="ml-2 text-ink-500">
                              {new Date(invoice.issuedAt).toLocaleString('en-PH')}
                            </span>
                          </span>
                          <span className="flex items-center gap-2 font-semibold">
                            {formatPeso(invoice.totalMinor)} <Printer size={15} />
                          </span>
                        </Link>
                      ))}
                  </div>
                </div>
              ) : null}
            </Glass>
          ) : null}

          <Glass variant="data" className="p-5">
            <div className="flex items-center gap-3">
              <ShoppingCart size={20} />
              <h2 className="font-display text-xl font-bold">{editingId ? 'Edit draft' : 'New draft'}</h2>
            </div>
            <form className="mt-5 grid gap-4" onSubmit={save}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium">
                  Order number
                  <input
                    value={orderNumber}
                    onChange={(event) => setOrderNumber(event.target.value)}
                    maxLength={64}
                    className="min-h-11 border border-ink-900/15 bg-white px-3"
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  Reseller
                  <select
                    value={customerId}
                    onChange={(event) => {
                      setCustomerId(event.target.value)
                      setPriceListId('')
                    }}
                    className="min-h-11 border border-ink-900/15 bg-white px-3"
                  >
                    {data.customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.fullName} ({customer.customerNumber})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  Fulfillment location
                  <select
                    value={locationId}
                    onChange={(event) => setLocationId(event.target.value)}
                    className="min-h-11 border border-ink-900/15 bg-white px-3"
                  >
                    {data.locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  Price list
                  <select
                    value={selectedPriceList?.id ?? ''}
                    onChange={(event) => setPriceListId(event.target.value)}
                    className="min-h-11 border border-ink-900/15 bg-white px-3"
                  >
                    {eligiblePriceLists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name} · minimum {quantityText(list.entries[0]?.thresholdMilli ?? 0)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="max-h-80 overflow-y-auto border border-ink-900/10">
                {selectedPriceList?.entries.map((entry) => {
                  const variant = data.variants.find((item) => item.id === entry.variantId)
                  const stock = data.inventory.find(
                    (item) => item.locationId === locationId && item.variantId === entry.variantId,
                  )
                  if (!variant) return null
                  return (
                    <label
                      key={entry.variantId}
                      className="grid grid-cols-[minmax(0,1fr)_105px] items-center gap-3 border-b border-ink-900/10 p-3 text-sm last:border-0"
                    >
                      <span>
                        <strong className="block">
                          {variant.productName} / {variant.variantName}
                        </strong>
                        <span className="text-xs text-ink-500">
                          {variant.sku} · {formatPeso(entry.unitPriceMinor)} ·{' '}
                          {quantityText(stock?.availableMilli ?? 0)} available
                        </span>
                      </span>
                      <input
                        inputMode="decimal"
                        aria-label={`${variant.productName} quantity`}
                        value={quantities[entry.variantId] ?? ''}
                        onChange={(event) =>
                          setQuantities((current) => ({
                            ...current,
                            [entry.variantId]: event.target.value.replace(/[^0-9.]/g, ''),
                          }))
                        }
                        placeholder="Qty"
                        className="min-h-10 border border-ink-900/15 bg-white px-3 text-right"
                      />
                    </label>
                  )
                }) ?? <p className="p-4 text-sm text-ink-500">Choose an eligible reseller and price list.</p>}
              </div>
              <label className="grid gap-2 text-sm font-medium">
                Notes
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  maxLength={1000}
                  rows={3}
                  className="border border-ink-900/15 bg-white p-3"
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-900/10 pt-4">
                <span>
                  <span className="block text-xs text-ink-500">Draft total</span>
                  <strong className="text-xl">{formatPeso(totalMinor)}</strong>
                </span>
                <Button type="submit" disabled={!data.canManage || busy || !selectedPriceList || !linePreview.length}>
                  <Save size={18} /> {editingId ? 'Update draft' : 'Save draft'}
                </Button>
              </div>
            </form>
          </Glass>
        </div>
      </div>
    </div>
  )
}
