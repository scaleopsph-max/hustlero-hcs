'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ArrowRightLeft, Plus, Truck } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  sessionContextResponseSchema,
  transferContextSchema,
  transferCreateResponseSchema,
  transferDispatchResponseSchema,
  transferReceiveResponseSchema,
  type TransferContext,
} from '@hcs/contracts'
import { Button, Chip, Glass } from '@hcs/ui'

const apiUrl = process.env.NEXT_PUBLIC_API_URL
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const inputClass =
  'min-h-11 w-full rounded-control border border-ink-900/15 bg-white/80 px-3 text-sm outline-none focus:border-ink-900'
function authClient(): SupabaseClient | null {
  return supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null
}
async function request(path: string, token: string, tenantId: string, options: RequestInit = {}) {
  if (!apiUrl) throw new Error('Back Office API URL is not configured.')
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenantId, ...options.headers },
  })
  const data: unknown = await response.json()
  if (!response.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? 'Request failed.')
  return data
}
export function TransferWorkspace() {
  const [auth] = useState(authClient)
  const [token, setToken] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [context, setContext] = useState<TransferContext>({ locations: [], variants: [], transfers: [] })
  const [source, setSource] = useState('')
  const [destination, setDestination] = useState('')
  const [variant, setVariant] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [number, setNumber] = useState('TR-0001')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async (nextToken: string, nextTenant: string) => {
    const next = transferContextSchema.parse(await request('/v1/transfers', nextToken, nextTenant))
    setContext(next)
    setSource((current) => current || next.locations[0]?.id || '')
    setDestination((current) => current || next.locations[1]?.id || '')
    setVariant((current) => current || next.variants[0]?.id || '')
  }, [])
  useEffect(() => {
    if (!auth) {
      setLoading(false)
      return
    }
    void auth.auth.getSession().then(async ({ data, error: sessionError }) => {
      try {
        if (sessionError) throw sessionError
        if (!data.session) throw new Error('Sign in to view transfers.')
        setToken(data.session.access_token)
        const session = sessionContextResponseSchema.parse(await request('/v1/me', data.session.access_token, ''))
        const tenant = session.tenants.find((item) => item.isOwner) ?? session.tenants[0]
        if (!tenant) throw new Error('Create a business first.')
        setTenantId(tenant.tenantId)
        await load(data.session.access_token, tenant.tenantId)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load transfers.')
      } finally {
        setLoading(false)
      }
    })
  }, [auth, load])
  async function create(event: FormEvent) {
    event.preventDefault()
    if (!token || !tenantId) return
    setBusy(true)
    setError(null)
    try {
      transferCreateResponseSchema.parse(
        await request('/v1/transfers', token, tenantId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `transfer-${crypto.randomUUID()}` },
          body: JSON.stringify({
            transferNumber: number,
            sourceLocationId: source,
            destinationLocationId: destination,
            items: [{ variantId: variant, quantityMilli: Math.round(Number(quantity) * 1000) }],
          }),
        }),
      )
      setNumber(`TR-${String(context.transfers.length + 2).padStart(4, '0')}`)
      await load(token, tenantId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create transfer.')
    } finally {
      setBusy(false)
    }
  }
  async function dispatch(id: string) {
    if (!token || !tenantId) return
    setBusy(true)
    try {
      transferDispatchResponseSchema.parse(
        await request(`/v1/transfers/${id}/dispatch`, token, tenantId, {
          method: 'POST',
          headers: { 'Idempotency-Key': `dispatch-${crypto.randomUUID()}` },
        }),
      )
      await load(token, tenantId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not dispatch transfer.')
    } finally {
      setBusy(false)
    }
  }
  async function receive(id: string, itemId: string, remaining: number) {
    if (!token || !tenantId) return
    setBusy(true)
    try {
      transferReceiveResponseSchema.parse(
        await request(`/v1/transfers/${id}/receive`, token, tenantId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `receive-${crypto.randomUUID()}` },
          body: JSON.stringify({ items: [{ stockTransferItemId: itemId, quantityMilli: remaining }] }),
        }),
      )
      await load(token, tenantId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not receive transfer.')
    } finally {
      setBusy(false)
    }
  }
  if (loading)
    return (
      <Glass variant="light" className="p-8 text-sm text-ink-500">
        Loading transfers...
      </Glass>
    )
  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      {error ? (
        <div className="border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-700 xl:col-span-2">{error}</div>
      ) : null}
      <Glass variant="light" className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <ArrowRightLeft size={22} />
          <div>
            <h2 className="font-display text-xl font-bold">New branch transfer</h2>
            <p className="text-sm text-ink-500">Stock leaves the source only on dispatch.</p>
          </div>
        </div>
        <form className="grid gap-3" onSubmit={create}>
          <input
            className={inputClass}
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            placeholder="Transfer number"
            required
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <select className={inputClass} value={source} onChange={(event) => setSource(event.target.value)} required>
              <option value="">Source branch</option>
              {context.locations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              required
            >
              <option value="">Destination branch</option>
              {context.locations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <select className={inputClass} value={variant} onChange={(event) => setVariant(event.target.value)} required>
            <option value="">Select product variant</option>
            {context.variants.map((item) => (
              <option key={item.id} value={item.id}>
                {item.productName} / {item.variantName} ({item.sku})
              </option>
            ))}
          </select>
          <input
            className={inputClass}
            type="number"
            min="0.001"
            step="0.001"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            required
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={busy || !context.locations.length || !context.variants.length}
          >
            <Plus size={16} className="mr-2" />
            Create draft transfer
          </Button>
        </form>
      </Glass>
      <Glass variant="data" className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-bold">Branch transfers</h2>
            <p className="text-sm text-ink-500">Dispatch and receive without creating sales.</p>
          </div>
          <Chip tone="neutral">{context.transfers.length} transfers</Chip>
        </div>
        <div className="grid gap-3">
          {context.transfers.length ? (
            context.transfers.map((transfer) => (
              <article key={transfer.id} className="border-t border-ink-900/10 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{transfer.transferNumber}</p>
                    <p className="text-sm text-ink-500">
                      {transfer.sourceLocationName} → {transfer.destinationLocationName}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Chip
                      tone={
                        transfer.status === 'received' ? 'success' : transfer.status === 'draft' ? 'neutral' : 'warning'
                      }
                    >
                      {transfer.status.replace('_', ' ')}
                    </Chip>
                    {transfer.status === 'draft' ? (
                      <Button size="sm" variant="secondary" onClick={() => void dispatch(transfer.id)} disabled={busy}>
                        <Truck size={15} className="mr-1.5" />
                        Dispatch
                      </Button>
                    ) : null}
                    {transfer.status === 'dispatched' || transfer.status === 'partially_received' ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          const item = transfer.items[0]
                          if (item)
                            void receive(transfer.id, item.id, item.requestedQuantityMilli - item.receivedQuantityMilli)
                        }}
                        disabled={busy}
                      >
                        <Truck size={15} className="mr-1.5" />
                        Receive
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 grid gap-1 text-sm">
                  {transfer.items.map((item) => (
                    <div key={item.id} className="flex justify-between">
                      <span>
                        {item.productName} / {item.variantName}
                      </span>
                      <span>
                        {item.receivedQuantityMilli / 1000} / {item.requestedQuantityMilli / 1000}
                      </span>
                    </div>
                  ))}
                </div>
              </article>
            ))
          ) : (
            <div className="py-16 text-center text-sm text-ink-500">No branch transfers yet.</div>
          )}
        </div>
      </Glass>
    </div>
  )
}
