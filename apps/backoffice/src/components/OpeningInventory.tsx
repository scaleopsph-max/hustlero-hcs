'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ArrowLeft, Check, Loader2, PackageOpen } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  openingInventoryContextSchema,
  openingInventoryCreateResponseSchema,
  sessionContextResponseSchema,
  type OpeningInventoryContext,
} from '@hcs/contracts'
import { Button, Glass } from '@hcs/ui'

import { Topbar } from './Topbar'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const apiUrl = process.env.NEXT_PUBLIC_API_URL

function client(): SupabaseClient | null {
  return supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null
}

async function apiRequest(
  path: string,
  accessToken: string,
  tenantId: string,
  options?: RequestInit,
  auth?: SupabaseClient,
  onTokenRefreshed?: (accessToken: string) => void,
) {
  if (!apiUrl) throw new Error('Back Office API URL is not configured.')
  const request = (token: string) =>
    fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenantId, ...options?.headers },
    })
  let response = await request(accessToken)
  if (response.status === 401 && auth) {
    const { data, error } = await auth.auth.refreshSession()
    if (!error && data.session?.access_token) {
      onTokenRefreshed?.(data.session.access_token)
      response = await request(data.session.access_token)
    }
  }
  const data: unknown = await response.json()
  if (!response.ok) {
    const error = data as { error?: { message?: string } }
    throw new Error(error.error?.message ?? 'The request could not be completed.')
  }
  return data
}

function parseScaled(input: string, scale: number): number {
  const match = /^(\d+)(?:\.(\d{0,3}))?$/.exec(input.trim())
  if (!match) throw new Error('Use a valid quantity with up to three decimal places.')
  return Number(match[1]) * 10 ** scale + Number((match[2] ?? '').padEnd(scale, '0').slice(0, scale))
}

function parseMoney(input: string): number {
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(input.trim())
  if (!match) throw new Error('Use a valid unit cost with up to two decimal places.')
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
}

function formatQuantity(quantityMilli: number): string {
  const whole = Math.floor(Math.abs(quantityMilli) / 1000)
  const fraction = String(Math.abs(quantityMilli) % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '')
  return `${quantityMilli < 0 ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

const inputClass =
  'h-11 w-full rounded-control border border-ink-900/15 bg-white px-3 text-right text-sm outline-none focus:border-ink-900 disabled:bg-ink-100 disabled:text-ink-500'

export function OpeningInventory() {
  const [auth] = useState(client)
  const [token, setToken] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [context, setContext] = useState<OpeningInventoryContext | null>(null)
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [costs, setCosts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadContext = useCallback(
    async (accessToken: string, selectedTenantId: string, locationId?: string) => {
      const query = locationId ? `?locationId=${encodeURIComponent(locationId)}` : ''
      const next = openingInventoryContextSchema.parse(
        await apiRequest(
          `/v1/inventory/opening-balances${query}`,
          accessToken,
          selectedTenantId,
          undefined,
          auth ?? undefined,
          setToken,
        ),
      )
      setContext(next)
      setQuantities((current) => {
        const values = { ...current }
        for (const item of next.items) {
          values[item.variantId] = item.opened
            ? formatQuantity(item.openingQuantityMilli)
            : (values[item.variantId] ?? '')
        }
        return values
      })
      setCosts((current) => {
        const values = { ...current }
        for (const item of next.items) {
          const unitCost = item.opened ? item.openingUnitCostMinor : item.defaultUnitCostMinor
          values[item.variantId] = values[item.variantId] ?? (unitCost === null ? '' : (unitCost / 100).toFixed(2))
        }
        return values
      })
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
        if (!data.session) throw new Error('Sign in before recording opening inventory.')
        setToken(data.session.access_token)
        const session = sessionContextResponseSchema.parse(
          await apiRequest('/v1/me', data.session.access_token, '', undefined, auth, setToken),
        )
        const tenant = session.tenants.find((item) => item.isOwner) ?? session.tenants[0]
        if (!tenant) throw new Error('Create a business before recording opening inventory.')
        setTenantId(tenant.tenantId)
        await loadContext(data.session.access_token, tenant.tenantId)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load opening inventory.')
      } finally {
        setLoading(false)
      }
    })
  }, [auth, loadContext])

  const pendingCount = useMemo(
    () =>
      context?.items.filter((item) => !item.opened && (quantities[item.variantId]?.trim() ?? '') !== '').length ?? 0,
    [context, quantities],
  )

  async function changeLocation(locationId: string) {
    if (!token || !tenantId) return
    setLoading(true)
    setError(null)
    setNotice(null)
    setQuantities({})
    setCosts({})
    try {
      await loadContext(token, tenantId, locationId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load this location.')
    } finally {
      setLoading(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || !tenantId || !context) return
    setBusy(true)
    setError(null)
    setNotice(null)
    let requestToken = token
    try {
      const entries = context.items
        .filter((item) => !item.opened && (quantities[item.variantId]?.trim() ?? '') !== '')
        .map((item) => ({
          variantId: item.variantId,
          quantityMilli: parseScaled(quantities[item.variantId] ?? '', 3),
          unitCostMinor: parseMoney(costs[item.variantId] ?? ''),
        }))
        .filter((entry) => entry.quantityMilli > 0)
      if (entries.length === 0) throw new Error('Enter at least one positive opening quantity.')
      const response = openingInventoryCreateResponseSchema.parse(
        await apiRequest(
          '/v1/inventory/opening-balances',
          requestToken,
          tenantId,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
            body: JSON.stringify({ locationId: context.selectedLocationId, entries }),
          },
          auth ?? undefined,
          (refreshedToken) => {
            requestToken = refreshedToken
            setToken(refreshedToken)
          },
        ),
      )
      setQuantities({})
      setCosts({})
      await loadContext(requestToken, tenantId, context.selectedLocationId)
      setNotice(`${response.movementCount} opening stock movement${response.movementCount === 1 ? '' : 's'} recorded.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record opening inventory.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Topbar title="Opening inventory" subtitle="Set the first stock position for each branch and variant." />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/inventory" className="inline-flex items-center gap-2 text-sm font-semibold text-ink-600">
          <ArrowLeft size={16} /> Inventory
        </Link>
        <Link href="/setup" className="text-sm font-semibold text-ink-600">
          Setup checklist
        </Link>
      </div>
      {error ? (
        <p role="alert" className="border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="border-l-2 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-900">
          {notice}
        </p>
      ) : null}
      <Glass variant="data" className="rounded-panel p-5">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink-900/10 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase text-ink-500">Inventory starting point</p>
            <h1 className="mt-1 font-display text-2xl font-bold">Opening stock by variant</h1>
          </div>
          <label className="w-full text-sm font-medium sm:w-72">
            Branch or location
            <select
              className="mt-1.5 h-11 w-full rounded-control border border-ink-900/15 bg-white px-3 text-sm"
              value={context?.selectedLocationId ?? ''}
              disabled={loading || busy}
              onChange={(event) => void changeLocation(event.target.value)}
            >
              {(context?.locations ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name} ({location.code})
                </option>
              ))}
            </select>
          </label>
        </div>
        {loading ? (
          <p className="py-14 text-center text-sm text-ink-500">Loading inventory...</p>
        ) : context?.items.length ? (
          <form onSubmit={(event) => void submit(event)}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead className="text-xs uppercase text-ink-500">
                  <tr>
                    <th className="py-3 font-semibold">Product and variant</th>
                    <th className="py-3 font-semibold">SKU</th>
                    <th className="py-3 text-right font-semibold">Opening quantity</th>
                    <th className="py-3 text-right font-semibold">Unit cost</th>
                    <th className="py-3 text-right font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {context.items.map((item) => (
                    <tr key={item.variantId} className="border-t border-ink-900/10">
                      <td className="py-3">
                        <span className="block font-semibold">{item.productName}</span>
                        <span className="text-xs text-ink-500">{item.variantName}</span>
                      </td>
                      <td className="py-3 text-ink-600">{item.sku}</td>
                      <td className="w-44 py-3 pl-4">
                        <input
                          aria-label={`Opening quantity for ${item.productName}, ${item.variantName}`}
                          className={inputClass}
                          inputMode="decimal"
                          pattern="[0-9]+([.][0-9]{1,3})?"
                          placeholder="0"
                          disabled={item.opened || busy}
                          value={quantities[item.variantId] ?? ''}
                          onChange={(event) =>
                            setQuantities((current) => ({ ...current, [item.variantId]: event.target.value }))
                          }
                        />
                      </td>
                      <td className="w-44 py-3 pl-4">
                        <input
                          aria-label={`Unit cost for ${item.productName}, ${item.variantName}`}
                          className={inputClass}
                          inputMode="decimal"
                          pattern="[0-9]+([.][0-9]{1,2})?"
                          placeholder="0.00"
                          disabled={item.opened || busy}
                          value={costs[item.variantId] ?? ''}
                          onChange={(event) =>
                            setCosts((current) => ({ ...current, [item.variantId]: event.target.value }))
                          }
                        />
                      </td>
                      <td className="py-3 text-right">
                        {item.opened ? (
                          <span className="inline-flex items-center gap-2 font-semibold text-emerald-700">
                            <Check size={16} /> Recorded
                          </span>
                        ) : (
                          <span className="text-ink-500">Pending</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-ink-900/10 pt-5">
              <p className="max-w-xl text-sm leading-6 text-ink-500">
                Recording creates immutable opening movements. Future corrections use inventory adjustments instead of
                changing these values.
              </p>
              <Button type="submit" variant="confirm" size="sm" disabled={busy || pendingCount === 0}>
                {busy ? (
                  <Loader2 size={17} className="mr-2 animate-spin" />
                ) : (
                  <PackageOpen size={17} className="mr-2" />
                )}
                Record opening inventory
              </Button>
            </div>
          </form>
        ) : (
          <div className="py-14 text-center">
            <PackageOpen size={32} className="mx-auto text-ink-400" />
            <p className="mt-3 font-semibold">No inventory-tracked variants yet</p>
            <Link href="/products" className="mt-2 inline-block text-sm font-semibold text-ink-600">
              Go to products
            </Link>
          </div>
        )}
      </Glass>
    </>
  )
}
