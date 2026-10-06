'use client'

import { selectActiveTenant } from '@/lib/active-tenant'
import { createClient } from '@/lib/supabase-browser'
import {
  priceListUpsertResponseSchema,
  pricingContextSchema,
  sessionContextResponseSchema,
  type PricingContext,
} from '@hcs/contracts'
import { Button, Chip, Glass, formatPeso, parsePeso } from '@hcs/ui'
import { Save, Tags } from 'lucide-react'
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

export function PricingWorkspace() {
  const [auth] = useState(() => (supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null))
  const [token, setToken] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [data, setData] = useState<PricingContext | null>(null)
  const [editingId, setEditingId] = useState<string | undefined>()
  const [pricingType, setPricingType] = useState<'wholesale' | 'dealer'>('wholesale')
  const [code, setCode] = useState('WHOLESALE')
  const [name, setName] = useState('Wholesale price list')
  const [groupCode, setGroupCode] = useState('CORE')
  const [groupName, setGroupName] = useState('Core products')
  const [threshold, setThreshold] = useState('6')
  const [isDefault, setIsDefault] = useState(true)
  const [isActive, setIsActive] = useState(true)
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [customerIds, setCustomerIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async (nextToken: string, nextTenant: string) => {
    setData(pricingContextSchema.parse(await call('/v1/pricing', nextToken, nextTenant)))
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
        if (!sessionData.session) throw new Error('Sign in to manage wholesale pricing.')
        const nextToken = sessionData.session.access_token
        const session = sessionContextResponseSchema.parse(await call('/v1/me', nextToken, ''))
        const tenant = selectActiveTenant(session.tenants)
        if (!tenant) throw new Error('Create a business first.')
        setToken(nextToken)
        setTenantId(tenant.tenantId)
        await load(nextToken, tenant.tenantId)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load pricing.')
      } finally {
        setLoading(false)
      }
    })
  }, [auth, load])

  const configuredCount = useMemo(
    () => Object.values(prices).filter((price) => parsePeso(price) >= 0 && price !== '').length,
    [prices],
  )

  function edit(list: PricingContext['priceLists'][number]) {
    setEditingId(list.id)
    setPricingType(list.pricingType)
    setCode(list.code)
    setName(list.name)
    setGroupCode(list.pricingGroup.code)
    setGroupName(list.pricingGroup.name)
    setThreshold(String(list.pricingGroup.thresholdMilli / 1000))
    setIsDefault(list.isDefault)
    setIsActive(list.isActive)
    setCustomerIds(list.customerIds)
    setPrices(
      Object.fromEntries(list.entries.map((entry) => [entry.variantId, (entry.unitPriceMinor / 100).toFixed(2)])),
    )
    setMessage(null)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!token || !tenantId || !data) return
    const entries = data.variants.flatMap((variant) => {
      const value = prices[variant.id]
      return value === undefined || value === '' ? [] : [{ variantId: variant.id, unitPriceMinor: parsePeso(value) }]
    })
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      priceListUpsertResponseSchema.parse(
        await call('/v1/pricing/price-lists', token, tenantId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `price-list-${crypto.randomUUID()}` },
          body: JSON.stringify({
            id: editingId,
            code,
            name,
            pricingType,
            isDefault,
            isActive,
            pricingGroup: { code: groupCode, name: groupName, thresholdMilli: Math.round(Number(threshold) * 1000) },
            customerIds,
            entries,
          }),
        }),
      )
      await load(token, tenantId)
      setMessage(editingId ? 'Price list updated.' : 'Price list created.')
      setEditingId(undefined)
      setPrices({})
      setCustomerIds([])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the price list.')
    } finally {
      setBusy(false)
    }
  }

  if (loading)
    return (
      <Glass variant="light" className="p-8 text-sm text-ink-500">
        Loading wholesale pricing...
      </Glass>
    )
  if (!data) return <div className="border-l-2 border-red-600 bg-red-50 p-4 text-sm text-red-800">{error}</div>

  return (
    <div className="grid gap-4">
      {error ? <div className="border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {message ? (
        <div className="border-l-2 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
        <Glass variant="light" className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-ink-900/10 p-5">
            <Tags size={20} />
            <h2 className="font-display text-xl font-bold">Price lists</h2>
          </div>
          {data.priceLists.length ? (
            data.priceLists.map((list) => (
              <button
                key={list.id}
                type="button"
                onClick={() => edit(list)}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-ink-900/10 p-5 text-left hover:bg-ink-900/[0.03]"
              >
                <span>
                  <strong className="block">{list.name}</strong>
                  <span className="mt-1 block text-sm text-ink-500">
                    {list.entries.length} variants · Minimum {list.pricingGroup.thresholdMilli / 1000} units ·{' '}
                    {list.customerIds.length || 'Any eligible'} reseller
                  </span>
                </span>
                <span className="flex gap-2">
                  <Chip tone={list.isActive ? 'success' : 'neutral'}>{list.isActive ? 'Active' : 'Off'}</Chip>
                  {list.isDefault ? <Chip tone="warning">Default</Chip> : null}
                </span>
              </button>
            ))
          ) : (
            <p className="p-5 text-sm text-ink-500">No wholesale or dealer price list yet.</p>
          )}
        </Glass>

        <Glass variant="data" className="p-5">
          <h2 className="font-display text-xl font-bold">{editingId ? 'Edit price list' : 'New price list'}</h2>
          <form className="mt-5 grid gap-4" onSubmit={save}>
            <div className="grid grid-cols-2 gap-2">
              {(['wholesale', 'dealer'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setPricingType(type)}
                  className={`min-h-11 border px-3 text-sm font-semibold capitalize ${pricingType === type ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-900/15 bg-white'}`}
                >
                  {type}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-2 text-sm font-medium">
                Code
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className="min-h-11 border border-ink-900/15 px-3"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="min-h-11 border border-ink-900/15 px-3"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Pricing group code
                <input
                  value={groupCode}
                  onChange={(e) => setGroupCode(e.target.value.toUpperCase())}
                  className="min-h-11 border border-ink-900/15 px-3"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Pricing group name
                <input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  className="min-h-11 border border-ink-900/15 px-3"
                />
              </label>
            </div>
            <label className="grid gap-2 text-sm font-medium">
              Minimum group quantity
              <input
                inputMode="decimal"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value.replace(/[^0-9.]/g, ''))}
                className="min-h-11 border border-ink-900/15 px-3"
              />
            </label>
            <div className="max-h-72 overflow-y-auto border border-ink-900/10">
              {data.variants.map((variant) => (
                <label
                  key={variant.id}
                  className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-3 border-b border-ink-900/10 p-3 text-sm last:border-0"
                >
                  <span>
                    <strong className="block">
                      {variant.productName} / {variant.variantName}
                    </strong>
                    <span className="text-xs text-ink-500">
                      {variant.sku} · Retail {formatPeso(variant.retailPriceMinor)}
                    </span>
                  </span>
                  <input
                    aria-label={`${variant.sku} price`}
                    inputMode="decimal"
                    placeholder="Wholesale"
                    value={prices[variant.id] ?? ''}
                    onChange={(e) =>
                      setPrices((current) => ({ ...current, [variant.id]: e.target.value.replace(/[^0-9.]/g, '') }))
                    }
                    className="min-h-10 border border-ink-900/15 px-2 text-right"
                  />
                </label>
              ))}
            </div>
            {data.customers.length ? (
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">Specific resellers (optional)</legend>
                {data.customers.map((customer) => (
                  <label key={customer.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={customerIds.includes(customer.id)}
                      onChange={(e) =>
                        setCustomerIds((current) =>
                          e.target.checked ? [...current, customer.id] : current.filter((id) => id !== customer.id),
                        )
                      }
                    />
                    {customer.fullName} ({customer.customerNumber})
                  </label>
                ))}
              </fieldset>
            ) : null}
            <div className="flex gap-5 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
                Default list
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                Active
              </label>
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !data.canManage || configuredCount === 0 || Number(threshold) <= 0}
            >
              <Save size={16} className="mr-2" />
              {busy ? 'Saving...' : 'Save price list'}
            </Button>
          </form>
        </Glass>
      </div>
    </div>
  )
}
