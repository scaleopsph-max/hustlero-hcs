'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { CheckCircle2, Download, Loader2, PackageSearch, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  inventoryMovementContextSchema,
  inventoryStockContextSchema,
  sessionContextResponseSchema,
  type InventoryMovementContext,
  type InventoryMovementType,
  type InventoryStockContext,
} from '@hcs/contracts'
import { Button, Chip, Glass, cn } from '@hcs/ui'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const apiUrl = process.env.NEXT_PUBLIC_API_URL

const movementLabels: Record<InventoryMovementType, string> = {
  OPENING_BALANCE: 'Opening balance',
  SALE: 'Sale',
  REFUND: 'Refund',
  PURCHASE_RECEIPT: 'Purchase receipt',
  TRANSFER_OUT: 'Transfer out',
  TRANSFER_IN: 'Transfer in',
  DAMAGE: 'Damage',
  ADJUSTMENT: 'Adjustment',
  RETURN_TO_SUPPLIER: 'Return to supplier',
}

function client(): SupabaseClient | null {
  return supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null
}

async function apiRequest(
  path: string,
  accessToken: string,
  tenantId: string,
  auth?: SupabaseClient,
  onTokenRefreshed?: (accessToken: string) => void,
) {
  if (!apiUrl) throw new Error('Back Office API URL is not configured.')
  const request = (token: string) =>
    fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenantId },
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

function formatQuantity(quantityMilli: number): string {
  const sign = quantityMilli < 0 ? '-' : ''
  const absolute = Math.abs(quantityMilli)
  const whole = Math.floor(absolute / 1000)
  const fraction = String(absolute % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '')
  return `${sign}${whole.toLocaleString('en-PH')}${fraction ? `.${fraction}` : ''}`
}

function formatMoney(moneyMinor: number | null): string {
  if (moneyMinor === null) return 'Not set'
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(moneyMinor / 100)
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(value))
}

function downloadCsv(stock: InventoryStockContext) {
  const location = stock.locations.find((item) => item.id === stock.selectedLocationId)
  const rows = [
    ['Location', 'Product', 'Variant', 'SKU', 'On hand', 'Reserved', 'Available', 'In transit', 'Damaged'],
    ...stock.items.map((item) => [
      location?.name ?? '',
      item.productName,
      item.variantName,
      item.sku,
      formatQuantity(item.onHandMilli),
      formatQuantity(item.reservedMilli),
      formatQuantity(item.availableMilli),
      formatQuantity(item.inTransitMilli),
      formatQuantity(item.damagedMilli),
    ]),
  ]
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `inventory-${location?.code.toLowerCase() ?? 'branch'}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

type InventoryView = 'stock' | 'ledger'

export function StockExplorer() {
  const [auth] = useState(client)
  const [token, setToken] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [stock, setStock] = useState<InventoryStockContext | null>(null)
  const [movements, setMovements] = useState<InventoryMovementContext['items']>([])
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
  const [view, setView] = useState<InventoryView>('stock')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadWorkspace = useCallback(
    async (accessToken: string, selectedTenantId: string, locationId?: string) => {
      const stockQuery = locationId ? `?locationId=${encodeURIComponent(locationId)}` : ''
      const nextStock = inventoryStockContextSchema.parse(
        await apiRequest(
          '/v1/inventory/stock' + stockQuery,
          accessToken,
          selectedTenantId,
          auth ?? undefined,
          setToken,
        ),
      )
      const nextMovements = inventoryMovementContextSchema.parse(
        await apiRequest(
          `/v1/inventory/movements?locationId=${encodeURIComponent(nextStock.selectedLocationId)}&limit=100`,
          accessToken,
          selectedTenantId,
          auth ?? undefined,
          setToken,
        ),
      )
      setStock(nextStock)
      setMovements(nextMovements.items)
      setSelectedVariantId((current) =>
        current && nextStock.items.some((item) => item.variantId === current)
          ? current
          : (nextStock.items[0]?.variantId ?? null),
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
        if (!data.session) throw new Error('Sign in to view inventory.')
        setToken(data.session.access_token)
        const session = sessionContextResponseSchema.parse(
          await apiRequest('/v1/me', data.session.access_token, '', auth, setToken),
        )
        const tenant = session.tenants.find((item) => item.isOwner) ?? session.tenants[0]
        if (!tenant) throw new Error('Create a business before viewing inventory.')
        setTenantId(tenant.tenantId)
        await loadWorkspace(data.session.access_token, tenant.tenantId)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load inventory.')
      } finally {
        setLoading(false)
      }
    })
  }, [auth, loadWorkspace])

  const filteredStock = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return stock?.items ?? []
    return (stock?.items ?? []).filter((item) =>
      `${item.productName} ${item.variantName} ${item.sku}`.toLowerCase().includes(needle),
    )
  }, [query, stock?.items])

  const filteredMovements = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return movements
    return movements.filter((item) =>
      `${item.productName} ${item.variantName} ${item.sku} ${item.sourceReference} ${item.actorLabel}`
        .toLowerCase()
        .includes(needle),
    )
  }, [movements, query])

  const selected = stock?.items.find((item) => item.variantId === selectedVariantId) ?? null
  const selectedMovements = movements.filter((item) => item.variantId === selectedVariantId)

  async function changeLocation(locationId: string) {
    if (!token || !tenantId) return
    setLoading(true)
    setError(null)
    try {
      await loadWorkspace(token, tenantId, locationId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load this location.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-control border border-ink-900/15 bg-white/70 p-1" role="tablist">
          {(
            [
              ['stock', 'Stock levels'],
              ['ledger', 'Movement ledger'],
            ] as const
          ).map(([code, label]) => (
            <button
              key={code}
              type="button"
              role="tab"
              aria-selected={view === code}
              onClick={() => setView(code)}
              className={cn(
                'h-9 px-4 text-sm font-semibold',
                view === code ? 'rounded-control bg-ink-900 text-white' : 'text-ink-700',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="inventory-location">
            Branch or location
          </label>
          <select
            id="inventory-location"
            value={stock?.selectedLocationId ?? ''}
            disabled={loading}
            onChange={(event) => void changeLocation(event.target.value)}
            className="h-10 rounded-control border border-ink-900/15 bg-white/70 px-3 text-sm font-semibold"
          >
            {(stock?.locations ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {location.name} ({location.code})
              </option>
            ))}
          </select>
          <Button size="sm" disabled={!stock || loading} onClick={() => stock && downloadCsv(stock)}>
            <Download size={17} className="mr-2" /> Export CSV
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="relative w-full max-w-md">
        <Search size={18} className="absolute left-3.5 top-3 text-ink-500" />
        <input
          type="search"
          aria-label={view === 'stock' ? 'Search stock' : 'Search movements'}
          placeholder={view === 'stock' ? 'Search product, variant or SKU' : 'Search SKU, reference or actor'}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-11 w-full rounded-control border border-ink-900/15 bg-white/70 pl-11 pr-4 text-sm"
        />
      </div>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center text-sm text-ink-500">
          <Loader2 size={20} className="mr-2 animate-spin" /> Loading inventory...
        </div>
      ) : view === 'stock' ? (
        <StockTable
          rows={filteredStock}
          selectedVariantId={selectedVariantId}
          onSelect={setSelectedVariantId}
          selected={selected}
          movements={selectedMovements}
          onClose={() => setSelectedVariantId(null)}
        />
      ) : (
        <MovementTable movements={filteredMovements} />
      )}
    </div>
  )
}

function StockTable({
  rows,
  selectedVariantId,
  onSelect,
  selected,
  movements,
  onClose,
}: {
  rows: InventoryStockContext['items']
  selectedVariantId: string | null
  onSelect: (variantId: string) => void
  selected: InventoryStockContext['items'][number] | null
  movements: InventoryMovementContext['items']
  onClose: () => void
}) {
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Glass variant="data" className="overflow-x-auto rounded-panel p-4">
        <table className="w-full min-w-[780px] border-collapse text-left text-sm">
          <thead className="text-xs uppercase text-ink-500">
            <tr>
              <th className="border-b border-ink-900/10 py-3 font-semibold">Product and variant</th>
              <th className="border-b border-ink-900/10 py-3 font-semibold">SKU</th>
              <th className="border-b border-ink-900/10 py-3 text-right font-semibold">On hand</th>
              <th className="border-b border-ink-900/10 py-3 text-right font-semibold">Reserved</th>
              <th className="border-b border-ink-900/10 py-3 text-right font-semibold">Available</th>
              <th className="border-b border-ink-900/10 py-3 text-right font-semibold">In transit</th>
              <th className="border-b border-ink-900/10 py-3 text-right font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const status = !item.hasBalance ? 'Not started' : item.availableMilli <= 0 ? 'Out of stock' : 'In stock'
              const tone = !item.hasBalance ? 'neutral' : item.availableMilli <= 0 ? 'critical' : 'success'
              return (
                <tr
                  key={item.variantId}
                  onClick={() => onSelect(item.variantId)}
                  className={cn(
                    'cursor-pointer border-b border-ink-900/10 hover:bg-ink-900/[0.03]',
                    selectedVariantId === item.variantId && 'bg-gold-500/20',
                  )}
                >
                  <td className="py-3 pr-4">
                    <span className="block font-semibold">{item.productName}</span>
                    <span className="text-xs text-ink-500">{item.variantName}</span>
                  </td>
                  <td className="py-3 pr-4 text-ink-600">{item.sku}</td>
                  <td className="py-3 text-right">{formatQuantity(item.onHandMilli)}</td>
                  <td className="py-3 text-right">{formatQuantity(item.reservedMilli)}</td>
                  <td className="py-3 text-right font-bold">{formatQuantity(item.availableMilli)}</td>
                  <td className="py-3 text-right">{formatQuantity(item.inTransitMilli)}</td>
                  <td className="py-3 text-right">
                    <Chip surface="light" tone={tone} className="h-6 text-xs">
                      {status}
                    </Chip>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <div className="py-14 text-center text-sm text-ink-500">
            <PackageSearch size={30} className="mx-auto mb-3" /> No inventory item matches this search.
          </div>
        ) : null}
      </Glass>
      {selected ? <StockDetails item={selected} movements={movements} onClose={onClose} /> : null}
    </div>
  )
}

function StockDetails({
  item,
  movements,
  onClose,
}: {
  item: InventoryStockContext['items'][number]
  movements: InventoryMovementContext['items']
  onClose: () => void
}) {
  return (
    <Glass variant="data" as="aside" className="rounded-panel p-5">
      <div className="flex items-start justify-between gap-3 border-b border-ink-900/10 pb-4">
        <div>
          <h2 className="font-display text-xl font-bold">{item.productName}</h2>
          <p className="text-sm text-ink-500">
            {item.variantName}, SKU {item.sku}
          </p>
        </div>
        <button type="button" aria-label="Close stock details" onClick={onClose} className="size-9 text-ink-600">
          <X size={20} />
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 border-b border-ink-900/10 py-4">
        {[
          ['On hand', formatQuantity(item.onHandMilli)],
          ['Available', formatQuantity(item.availableMilli)],
          ['Reserved', formatQuantity(item.reservedMilli)],
          ['Damaged', formatQuantity(item.damagedMilli)],
          ['In transit', formatQuantity(item.inTransitMilli)],
          ['Average cost', formatMoney(item.averageUnitCostMinor)],
        ].map(([label, value]) => (
          <div key={label} className="border-b border-ink-900/10 py-3 last:border-0">
            <dt className="text-xs text-ink-500">{label}</dt>
            <dd className="mt-1 font-display text-lg font-bold">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-bold">Latest movements</h3>
          <span className="text-xs text-ink-500">{movements.length}</span>
        </div>
        {movements.length ? (
          movements.slice(0, 8).map((movement) => <MovementLine key={movement.id} movement={movement} />)
        ) : (
          <p className="border-t border-ink-900/10 py-5 text-sm text-ink-500">No stock movement recorded yet.</p>
        )}
      </div>
    </Glass>
  )
}

function MovementLine({ movement }: { movement: InventoryMovementContext['items'][number] }) {
  return (
    <div className="border-t border-ink-900/10 py-3">
      <div className="flex justify-between gap-3">
        <span className="font-semibold">{movementLabels[movement.movementType]}</span>
        <span className={cn('font-bold', movement.quantityMilli < 0 ? 'text-red-700' : 'text-emerald-700')}>
          {movement.quantityMilli > 0 ? '+' : ''}
          {formatQuantity(movement.quantityMilli)}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-600">
        {movement.sourceReference}, by {movement.actorLabel}
      </p>
      <div className="mt-1 flex justify-between gap-3 text-xs text-ink-500">
        <span>{formatDate(movement.occurredAt)}</span>
        <span>Balance {formatQuantity(movement.balanceAfterMilli)}</span>
      </div>
    </div>
  )
}

function MovementTable({ movements }: { movements: InventoryMovementContext['items'] }) {
  return (
    <Glass variant="data" className="overflow-x-auto rounded-panel p-4">
      <table className="w-full min-w-[900px] border-collapse text-left text-sm">
        <thead className="text-xs uppercase text-ink-500">
          <tr>
            <th className="border-b border-ink-900/10 py-3 font-semibold">Date and type</th>
            <th className="border-b border-ink-900/10 py-3 font-semibold">Product and SKU</th>
            <th className="border-b border-ink-900/10 py-3 font-semibold">Reference</th>
            <th className="border-b border-ink-900/10 py-3 font-semibold">Actor</th>
            <th className="border-b border-ink-900/10 py-3 text-right font-semibold">Quantity</th>
            <th className="border-b border-ink-900/10 py-3 text-right font-semibold">Balance after</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((movement) => (
            <tr key={movement.id} className="border-b border-ink-900/10">
              <td className="py-3 pr-4">
                <span className="block font-semibold">{movementLabels[movement.movementType]}</span>
                <span className="text-xs text-ink-500">{formatDate(movement.occurredAt)}</span>
              </td>
              <td className="py-3 pr-4">
                <span className="block font-semibold">{movement.productName}</span>
                <span className="text-xs text-ink-500">
                  {movement.variantName}, {movement.sku}
                </span>
              </td>
              <td className="py-3 pr-4 text-ink-600">{movement.sourceReference}</td>
              <td className="py-3 pr-4 text-ink-600">{movement.actorLabel}</td>
              <td
                className={cn(
                  'py-3 text-right font-bold',
                  movement.quantityMilli < 0 ? 'text-red-700' : 'text-emerald-700',
                )}
              >
                {movement.quantityMilli > 0 ? '+' : ''}
                {formatQuantity(movement.quantityMilli)}
              </td>
              <td className="py-3 text-right font-semibold">{formatQuantity(movement.balanceAfterMilli)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {movements.length === 0 ? (
        <div className="py-14 text-center text-sm text-ink-500">
          <CheckCircle2 size={30} className="mx-auto mb-3" /> No inventory movements match this view.
        </div>
      ) : null}
    </Glass>
  )
}
