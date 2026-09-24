'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ClipboardList, Loader2, Plus, Send, Truck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  purchasingContextSchema,
  purchaseOrderCreateResponseSchema,
  purchaseOrderSendResponseSchema,
  purchaseReceiptResponseSchema,
  supplierCreateResponseSchema,
  sessionContextResponseSchema,
  type PurchasingContext,
} from '@hcs/contracts'
import { Button, Chip, Glass } from '@hcs/ui'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const apiUrl = process.env.NEXT_PUBLIC_API_URL
const inputClass =
  'min-h-11 w-full rounded-control border border-ink-900/15 bg-white/80 px-3 text-sm outline-none focus:border-ink-900'

function client(): SupabaseClient | null {
  return supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null
}

async function apiRequest(
  path: string,
  token: string,
  tenantId: string,
  options: RequestInit = {},
  auth?: SupabaseClient,
  refresh?: (token: string) => void,
) {
  if (!apiUrl) throw new Error('Back Office API URL is not configured.')
  const request = (nextToken: string) =>
    fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${nextToken}`, 'X-Tenant-Id': tenantId, ...options.headers },
    })
  let response = await request(token)
  if (response.status === 401 && auth) {
    const { data, error } = await auth.auth.refreshSession()
    if (!error && data.session?.access_token) {
      refresh?.(data.session.access_token)
      response = await request(data.session.access_token)
    }
  }
  const payload: unknown = await response.json()
  if (!response.ok)
    throw new Error(
      (payload as { error?: { message?: string } }).error?.message ?? 'The request could not be completed.',
    )
  return payload
}

function money(value: number | null) {
  return value === null
    ? 'Not set'
    : new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value / 100)
}

function quantity(value: number) {
  return (value / 1000).toLocaleString('en-PH', { maximumFractionDigits: 3 })
}

function key(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

export function PurchasingWorkspace() {
  const [auth] = useState(client)
  const [token, setToken] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [context, setContext] = useState<PurchasingContext>({ suppliers: [], locations: [], variants: [], orders: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [supplierName, setSupplierName] = useState('')
  const [supplierContact, setSupplierContact] = useState('')
  const [orderNumber, setOrderNumber] = useState('PO-0001')
  const [supplierId, setSupplierId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [variantId, setVariantId] = useState('')
  const [orderQuantity, setOrderQuantity] = useState('1')
  const [unitCost, setUnitCost] = useState('')
  const [receivingOrderId, setReceivingOrderId] = useState<string | null>(null)
  const [receiveQuantities, setReceiveQuantities] = useState<Record<string, string>>({})
  const [deliveryReference, setDeliveryReference] = useState('')

  const load = useCallback(
    async (nextToken: string, nextTenantId: string) => {
      const next = purchasingContextSchema.parse(
        await apiRequest('/v1/purchasing', nextToken, nextTenantId, {}, auth ?? undefined, setToken),
      )
      setContext(next)
      setSupplierId((current) => current || next.suppliers[0]?.id || '')
      setLocationId((current) => current || next.locations[0]?.id || '')
      setVariantId((current) => current || next.variants[0]?.id || '')
      setUnitCost(
        (current) =>
          current ||
          (next.variants[0]?.defaultUnitCostMinor === null || next.variants[0]?.defaultUnitCostMinor === undefined
            ? ''
            : String(next.variants[0].defaultUnitCostMinor / 100)),
      )
    },
    [auth],
  )

  useEffect(() => {
    if (!auth) {
      setLoading(false)
      return
    }
    void auth.auth.getSession().then(async ({ data, error: sessionError }) => {
      try {
        if (sessionError) throw sessionError
        if (!data.session) throw new Error('Sign in to view purchasing.')
        setToken(data.session.access_token)
        const session = sessionContextResponseSchema.parse(
          await apiRequest('/v1/me', data.session.access_token, '', {}, auth, setToken),
        )
        const tenant = session.tenants.find((item) => item.isOwner) ?? session.tenants[0]
        if (!tenant) throw new Error('Create a business before using purchasing.')
        setTenantId(tenant.tenantId)
        await load(data.session.access_token, tenant.tenantId)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load purchasing.')
      } finally {
        setLoading(false)
      }
    })
  }, [auth, load])

  const selectedVariant = useMemo(
    () => context.variants.find((item) => item.id === variantId),
    [context.variants, variantId],
  )

  async function submitSupplier(event: FormEvent) {
    event.preventDefault()
    if (!token || !tenantId) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = supplierCreateResponseSchema.parse(
        await apiRequest(
          '/v1/purchasing/suppliers',
          token,
          tenantId,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key('supplier') },
            body: JSON.stringify({
              name: supplierName,
              contactName: supplierContact || null,
              contactPhone: null,
              contactEmail: null,
            }),
          },
          auth ?? undefined,
          setToken,
        ),
      )
      setSupplierName('')
      setSupplierContact('')
      setNotice(`Supplier added: ${result.supplierId.slice(0, 8)}`)
      await load(token, tenantId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add supplier.')
    } finally {
      setBusy(false)
    }
  }

  async function submitOrder(event: FormEvent) {
    event.preventDefault()
    if (!token || !tenantId) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = purchaseOrderCreateResponseSchema.parse(
        await apiRequest(
          '/v1/purchasing/orders',
          token,
          tenantId,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key('purchase-order') },
            body: JSON.stringify({
              supplierId,
              locationId,
              orderNumber,
              expectedAt: null,
              notes: null,
              lines: [
                {
                  variantId,
                  quantityMilli: Math.round(Number(orderQuantity) * 1000),
                  unitCostMinor: Math.round(Number(unitCost || 0) * 100),
                },
              ],
            }),
          },
          auth ?? undefined,
          setToken,
        ),
      )
      setNotice(`Draft ${result.purchaseOrderId.slice(0, 8)} created.`)
      setOrderNumber(`PO-${String(context.orders.length + 2).padStart(4, '0')}`)
      await load(token, tenantId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create purchase order.')
    } finally {
      setBusy(false)
    }
  }

  async function sendOrder(id: string) {
    if (!token || !tenantId) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      purchaseOrderSendResponseSchema.parse(
        await apiRequest(
          `/v1/purchasing/orders/${id}/send`,
          token,
          tenantId,
          { method: 'POST', headers: { 'Idempotency-Key': key('send-order') } },
          auth ?? undefined,
          setToken,
        ),
      )
      setNotice('Purchase order sent. It is ready for receiving.')
      await load(token, tenantId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send order.')
    } finally {
      setBusy(false)
    }
  }

  async function receiveOrder(id: string) {
    if (!token || !tenantId) return
    const order = context.orders.find((item) => item.id === id)
    if (!order) return
    const lines = order.lines
      .map((line) => ({
        purchaseOrderLineId: line.id,
        quantityMilli: Math.round(Number(receiveQuantities[line.id] || 0) * 1000),
      }))
      .filter((line) => line.quantityMilli > 0)
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      purchaseReceiptResponseSchema.parse(
        await apiRequest(
          `/v1/purchasing/orders/${id}/receive`,
          token,
          tenantId,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key('receive-order') },
            body: JSON.stringify({ lines, deliveryReference: deliveryReference || null }),
          },
          auth ?? undefined,
          setToken,
        ),
      )
      setReceivingOrderId(null)
      setDeliveryReference('')
      setNotice('Stock received and posted to the inventory ledger.')
      await load(token, tenantId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not receive stock.')
    } finally {
      setBusy(false)
    }
  }

  if (loading)
    return (
      <Glass variant="light" className="p-8 text-sm text-ink-500">
        Loading purchasing workspace...
      </Glass>
    )
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <div className="grid gap-4">
        <Glass variant="light" className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-control bg-ink-900 text-gold-300">
              <Truck size={19} />
            </div>
            <div>
              <h2 className="font-display text-xl font-bold">Suppliers</h2>
              <p className="text-sm text-ink-500">Keep vendor contacts ready for branch purchasing.</p>
            </div>
          </div>
          <form onSubmit={submitSupplier} className="grid gap-3">
            <input
              className={inputClass}
              value={supplierName}
              onChange={(event) => setSupplierName(event.target.value)}
              placeholder="Supplier name"
              required
            />
            <input
              className={inputClass}
              value={supplierContact}
              onChange={(event) => setSupplierContact(event.target.value)}
              placeholder="Contact person (optional)"
            />
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              <Plus size={17} className="mr-2" />
              Add supplier
            </Button>
          </form>
          <div className="mt-5 grid gap-2">
            {context.suppliers.map((supplier) => (
              <div
                key={supplier.id}
                className="flex items-center justify-between border-t border-ink-900/10 py-3 text-sm"
              >
                <span className="font-semibold">{supplier.name}</span>
                <span className="text-ink-500">{supplier.contactName ?? 'No contact'}</span>
              </div>
            ))}
          </div>
        </Glass>
        <Glass variant="light" className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <ClipboardList size={22} />
            <div>
              <h2 className="font-display text-xl font-bold">New purchase order</h2>
              <p className="text-sm text-ink-500">Drafts do not change stock until received.</p>
            </div>
          </div>
          <form onSubmit={submitOrder} className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                className={inputClass}
                value={supplierId}
                onChange={(event) => setSupplierId(event.target.value)}
                required
              >
                <option value="">Select supplier</option>
                {context.suppliers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select
                className={inputClass}
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
                required
              >
                <option value="">Receiving location</option>
                {context.locations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <input
              className={inputClass}
              value={orderNumber}
              onChange={(event) => setOrderNumber(event.target.value)}
              placeholder="Order number"
              required
            />
            <select
              className={inputClass}
              value={variantId}
              onChange={(event) => {
                setVariantId(event.target.value)
                const next = context.variants.find((item) => item.id === event.target.value)
                if (next?.defaultUnitCostMinor !== null && next?.defaultUnitCostMinor !== undefined)
                  setUnitCost(String(next.defaultUnitCostMinor / 100))
              }}
              required
            >
              <option value="">Select product variant</option>
              {context.variants.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.productName} / {item.variantName} ({item.sku})
                </option>
              ))}
            </select>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className={inputClass}
                type="number"
                min="0.001"
                step="0.001"
                value={orderQuantity}
                onChange={(event) => setOrderQuantity(event.target.value)}
                placeholder="Quantity"
                required
              />
              <input
                className={inputClass}
                type="number"
                min="0"
                step="0.01"
                value={unitCost}
                onChange={(event) => setUnitCost(event.target.value)}
                placeholder="Unit cost (PHP)"
                required
              />
            </div>
            <p className="text-xs text-ink-500">
              {selectedVariant
                ? `${selectedVariant.productName} / ${selectedVariant.variantName} · ${money(Math.round(Number(unitCost || 0) * 100))}`
                : 'Choose an active product variant.'}
            </p>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={busy || !context.suppliers.length || !context.locations.length || !context.variants.length}
            >
              <Plus size={17} className="mr-2" />
              Create draft PO
            </Button>
          </form>
        </Glass>
      </div>
      <Glass variant="data" className="min-w-0 overflow-hidden p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold">Purchase orders</h2>
            <p className="text-sm text-ink-500">Commitments, dispatch, and received stock by location.</p>
          </div>
          <Chip tone="neutral">{context.orders.length} orders</Chip>
        </div>
        {error ? (
          <div className="mb-3 border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        ) : null}
        {notice ? (
          <div className="mb-3 border-l-2 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>
        ) : null}
        <div className="grid gap-3">
          {context.orders.length ? (
            context.orders.map((order) => (
              <article key={order.id} className="border-t border-ink-900/10 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {order.orderNumber} · {order.supplierName}
                    </p>
                    <p className="text-sm text-ink-500">
                      {order.locationName} · {order.lines.length} line{order.lines.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Chip
                      tone={order.status === 'received' ? 'success' : order.status === 'draft' ? 'neutral' : 'warning'}
                    >
                      {order.status.replace('_', ' ')}
                    </Chip>
                    {order.status === 'draft' ? (
                      <Button size="sm" variant="secondary" onClick={() => void sendOrder(order.id)} disabled={busy}>
                        <Send size={15} className="mr-1.5" />
                        Send
                      </Button>
                    ) : null}
                    {order.status === 'ordered' || order.status === 'partially_received' ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          setReceivingOrderId(order.id)
                          setReceiveQuantities(
                            Object.fromEntries(
                              order.lines.map((line) => [
                                line.id,
                                String((line.orderedQuantityMilli - line.receivedQuantityMilli) / 1000),
                              ]),
                            ),
                          )
                        }}
                        disabled={busy}
                      >
                        <Truck size={15} className="mr-1.5" />
                        Receive
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-sm">
                  {order.lines.map((line) => (
                    <div key={line.id} className="flex flex-wrap justify-between gap-2 text-ink-700">
                      <span>
                        {line.productName} / {line.variantName} <span className="text-ink-500">({line.sku})</span>
                      </span>
                      <span>
                        {quantity(line.receivedQuantityMilli)} / {quantity(line.orderedQuantityMilli)} ·{' '}
                        {money(line.unitCostMinor)}
                      </span>
                    </div>
                  ))}
                </div>
                {receivingOrderId === order.id ? (
                  <div className="mt-4 grid gap-3 border-t border-ink-900/10 pt-4">
                    <p className="text-sm font-semibold">Receive delivery</p>
                    {order.lines.map((line) => (
                      <label key={line.id} className="grid gap-1 text-xs font-semibold text-ink-600">
                        <span>
                          {line.productName} / {line.variantName} · remaining{' '}
                          {quantity(line.orderedQuantityMilli - line.receivedQuantityMilli)}
                        </span>
                        <input
                          className={inputClass}
                          type="number"
                          min="0"
                          max={(line.orderedQuantityMilli - line.receivedQuantityMilli) / 1000}
                          step="0.001"
                          value={receiveQuantities[line.id] ?? ''}
                          onChange={(event) =>
                            setReceiveQuantities((current) => ({ ...current, [line.id]: event.target.value }))
                          }
                        />
                      </label>
                    ))}
                    <input
                      className={inputClass}
                      value={deliveryReference}
                      onChange={(event) => setDeliveryReference(event.target.value)}
                      placeholder="Delivery reference (optional)"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" onClick={() => void receiveOrder(order.id)} disabled={busy}>
                        {busy ? (
                          <Loader2 size={16} className="mr-2 animate-spin" />
                        ) : (
                          <Truck size={16} className="mr-2" />
                        )}
                        Post receipt
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setReceivingOrderId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </article>
            ))
          ) : (
            <div className="py-16 text-center text-sm text-ink-500">
              No purchase orders yet. Add a supplier and create the first draft.
            </div>
          )}
        </div>
      </Glass>
    </div>
  )
}
