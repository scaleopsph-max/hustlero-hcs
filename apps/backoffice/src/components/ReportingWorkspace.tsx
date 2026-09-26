'use client'

import { createClient } from '@supabase/supabase-js'
import { Download, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  dashboardContextSchema,
  inventoryReportContextSchema,
  salesReportContextSchema,
  sessionContextResponseSchema,
  type DashboardContext,
  type InventoryReportContext,
  type SalesReportContext,
} from '@hcs/contracts'
import { Button, Chip, Glass, formatPeso } from '@hcs/ui'

const apiUrl = process.env.NEXT_PUBLIC_API_URL
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

function localDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

async function call(path: string, token: string, tenantId: string) {
  if (!apiUrl) throw new Error('Back Office API URL is not configured.')
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenantId },
  })
  const data: unknown = await response.json()
  if (!response.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? 'Request failed.')
  return data
}

function csvCell(value: string | number) {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function downloadCsv(name: string, rows: Array<Array<string | number>>) {
  const blob = new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = name
  link.click()
  URL.revokeObjectURL(href)
}

function quantity(value: number) {
  return (value / 1000).toLocaleString('en-PH', { maximumFractionDigits: 3 })
}

function SummaryCards({ summary }: { summary: DashboardContext['summary'] }) {
  const cards = [
    ['Net sales', formatPeso(summary.netSalesCentavos)],
    ['Gross profit', formatPeso(summary.grossProfitCentavos)],
    ['Transactions', summary.transactionCount.toLocaleString('en-PH')],
    ['COGS', formatPeso(summary.cogsCentavos)],
    ['Refunds', formatPeso(summary.refundsCentavos)],
    ['Taxes', formatPeso(summary.taxCentavos)],
  ]
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      {cards.map(([label, value]) => (
        <div key={label} className="min-w-0 border border-ink-900/10 bg-white p-4">
          <div className="text-xs font-medium text-ink-500">{label}</div>
          <div className="mt-2 break-words font-display text-2xl font-bold">{value}</div>
        </div>
      ))}
    </div>
  )
}

export function ReportingWorkspace({ mode }: { mode: 'dashboard' | 'reports' }) {
  const [auth] = useState(() => (supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null))
  const [token, setToken] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [from, setFrom] = useState(localDate(-6))
  const [to, setTo] = useState(localDate())
  const [locationId, setLocationId] = useState('')
  const [channel, setChannel] = useState<'all' | 'pos'>('all')
  const [dashboard, setDashboard] = useState<DashboardContext | null>(null)
  const [sales, setSales] = useState<SalesReportContext | null>(null)
  const [inventory, setInventory] = useState<InventoryReportContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (
      nextToken: string,
      nextTenant: string,
      nextFrom: string,
      nextTo: string,
      nextLocation: string,
      nextChannel: 'all' | 'pos',
    ) => {
      setLoading(true)
      setError(null)
      const query = new URLSearchParams({ from: nextFrom, to: nextTo, channel: nextChannel })
      if (nextLocation) query.set('locationId', nextLocation)
      try {
        if (mode === 'dashboard') {
          setDashboard(dashboardContextSchema.parse(await call(`/v1/dashboard?${query}`, nextToken, nextTenant)))
        } else {
          const [salesData, inventoryData] = await Promise.all([
            call(`/v1/reports/sales?${query}`, nextToken, nextTenant),
            call(`/v1/reports/inventory?${query}`, nextToken, nextTenant),
          ])
          setSales(salesReportContextSchema.parse(salesData))
          setInventory(inventoryReportContextSchema.parse(inventoryData))
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load reporting data.')
      } finally {
        setLoading(false)
      }
    },
    [mode],
  )

  useEffect(() => {
    if (!auth) {
      setError('Back Office authentication is not configured.')
      setLoading(false)
      return
    }
    void auth.auth.getSession().then(async ({ data, error: sessionError }) => {
      try {
        if (sessionError) throw sessionError
        if (!data.session) throw new Error('Sign in to view business reporting.')
        const nextToken = data.session.access_token
        const session = sessionContextResponseSchema.parse(await call('/v1/me', nextToken, ''))
        const tenant = session.tenants.find((entry) => entry.isOwner) ?? session.tenants[0]
        if (!tenant) throw new Error('Create a business first.')
        setToken(nextToken)
        setTenantId(tenant.tenantId)
        await load(nextToken, tenant.tenantId, localDate(-6), localDate(), '', 'all')
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load reporting data.')
        setLoading(false)
      }
    })
  }, [auth, load])

  const locations = dashboard?.locations ?? sales?.locations ?? inventory?.locations ?? []
  const maxTrend = useMemo(
    () => Math.max(1, ...(dashboard?.salesTrend.map((point) => Math.max(point.netSalesCentavos, 0)) ?? [1])),
    [dashboard],
  )

  return (
    <div className="grid gap-4">
      <Glass variant="light" className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_1.2fr_1fr_auto]">
        <label className="grid gap-1 text-xs font-semibold text-ink-500">
          From
          <input
            type="date"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
            className="min-h-11 border border-ink-900/15 bg-white px-3 text-sm text-ink-900"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-ink-500">
          Channel
          <select
            value={channel}
            onChange={(event) => setChannel(event.target.value as 'all' | 'pos')}
            className="min-h-11 border border-ink-900/15 bg-white px-3 text-sm text-ink-900"
          >
            <option value="all">All channels</option>
            <option value="pos">POS</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-ink-500">
          To
          <input
            type="date"
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
            className="min-h-11 border border-ink-900/15 bg-white px-3 text-sm text-ink-900"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-ink-500">
          Location
          <select
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            className="min-h-11 border border-ink-900/15 bg-white px-3 text-sm text-ink-900"
          >
            <option value="">All locations</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          variant="primary"
          className="self-end"
          disabled={loading || !token || !tenantId || !from || !to}
          onClick={() => token && tenantId && void load(token, tenantId, from, to, locationId, channel)}
        >
          <RefreshCw size={16} className="mr-2" />
          Apply
        </Button>
      </Glass>
      {error ? <div className="border-l-2 border-red-600 bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
      {loading ? (
        <Glass variant="light" className="p-8 text-sm text-ink-500">
          Loading live reporting data...
        </Glass>
      ) : null}
      {!loading && dashboard ? <DashboardView data={dashboard} maxTrend={maxTrend} /> : null}
      {!loading && sales && inventory ? <ReportsView sales={sales} inventory={inventory} /> : null}
    </div>
  )
}

function DashboardView({ data, maxTrend }: { data: DashboardContext; maxTrend: number }) {
  return (
    <>
      <SummaryCards summary={data.summary} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
        <Glass variant="data" className="p-5">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="font-display text-xl font-bold">Sales performance</h2>
            <Chip tone="neutral">
              {data.scope.from} to {data.scope.to}
            </Chip>
          </div>
          <div className="flex h-56 items-end gap-2 border-b border-ink-900/15">
            {data.salesTrend.map((point) => (
              <div key={point.date} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-2 text-center">
                <div
                  className="mx-auto w-full max-w-10 bg-gold-500"
                  style={{ height: `${Math.max(2, (Math.max(point.netSalesCentavos, 0) / maxTrend) * 100)}%` }}
                  title={`${point.date}: ${formatPeso(point.netSalesCentavos)}`}
                />
                <span className="truncate text-[10px] text-ink-500">{point.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </Glass>
        <Glass variant="light" className="p-5">
          <h2 className="font-display text-xl font-bold">Inventory health</h2>
          <div className="mt-5 grid grid-cols-2 gap-4">
            <Metric label="Active SKUs" value={data.inventory.skuCount} />
            <Metric label="Out of stock" value={data.inventory.outOfStockCount} />
            <Metric label="Available units" value={quantity(data.inventory.availableMilli)} />
            <Metric label="Stock value" value={formatPeso(data.inventory.valuationCentavos)} />
          </div>
          <div className="mt-5 border-t border-ink-900/10 pt-4 text-sm">
            <strong>{data.registers.openCount}</strong> of {data.registers.totalCount} registers open
          </div>
        </Glass>
      </div>
      <Glass variant="light" className="overflow-hidden">
        <div className="border-b border-ink-900/10 p-5">
          <h2 className="font-display text-xl font-bold">Branch performance</h2>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_1fr_1fr_80px] gap-3 border-b border-ink-900/10 px-5 py-3 text-xs font-semibold uppercase text-ink-500">
          <span>Location</span>
          <span className="text-right">Net sales</span>
          <span className="text-right">Gross profit</span>
          <span className="text-right">Txns</span>
        </div>
        {data.branches.map((branch) => (
          <div
            key={branch.locationId}
            className="grid grid-cols-[minmax(0,1fr)_1fr_1fr_80px] gap-3 border-b border-ink-900/10 px-5 py-4 text-sm last:border-0"
          >
            <strong>{branch.locationName}</strong>
            <span className="text-right">{formatPeso(branch.netSalesCentavos)}</span>
            <span className="text-right">{formatPeso(branch.grossProfitCentavos)}</span>
            <span className="text-right">{branch.transactionCount}</span>
          </div>
        ))}
      </Glass>
    </>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs text-ink-500">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold">{value}</div>
    </div>
  )
}

function ReportsView({ sales, inventory }: { sales: SalesReportContext; inventory: InventoryReportContext }) {
  const salesRows = sales.byItem.map((item) => [
    item.label,
    item.variantName,
    item.sku,
    quantity(item.quantityMilli ?? 0),
    item.transactionCount,
    item.grossSalesCentavos / 100,
    item.refundsCentavos / 100,
    item.netSalesCentavos / 100,
    item.cogsCentavos / 100,
    item.grossProfitCentavos / 100,
  ])
  const inventoryRows = inventory.items.map((item) => [
    item.locationName,
    item.productName,
    item.variantName,
    item.sku,
    quantity(item.onHandMilli),
    quantity(item.reservedMilli),
    quantity(item.availableMilli),
    quantity(item.inTransitMilli),
    (item.averageUnitCostCentavos ?? 0) / 100,
    item.valuationCentavos / 100,
  ])
  return (
    <>
      <SummaryCards summary={sales.summary} />
      <Glass variant="light" className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-ink-900/10 p-5">
          <div>
            <h2 className="font-display text-xl font-bold">Sales by item</h2>
            <p className="text-sm text-ink-500">Net of refunds within the selected business dates.</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              downloadCsv(`hcs-sales-${sales.scope.from}-${sales.scope.to}.csv`, [
                [
                  'Product',
                  'Variant',
                  'SKU',
                  'Net quantity',
                  'Transactions',
                  'Gross sales',
                  'Refunds',
                  'Net sales',
                  'COGS',
                  'Gross profit',
                ],
                ...salesRows,
              ])
            }
          >
            <Download size={16} className="mr-2" />
            CSV
          </Button>
        </div>
        <ReportTable
          rows={sales.byItem.map((item) => [
            <div key="item">
              <strong>{item.label}</strong>
              <div className="text-xs text-ink-500">
                {item.variantName} · {item.sku}
              </div>
            </div>,
            quantity(item.quantityMilli ?? 0),
            item.transactionCount,
            formatPeso(item.netSalesCentavos),
            formatPeso(item.grossProfitCentavos),
          ])}
          headings={['Item', 'Net qty', 'Txns', 'Net sales', 'Gross profit']}
        />
      </Glass>
      <div className="grid gap-4 xl:grid-cols-2">
        <Breakdown title="By category" rows={sales.byCategory} />
        <Breakdown title="By employee" rows={sales.byEmployee} />
      </div>
      <Glass variant="light" className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-ink-900/10 p-5">
          <div>
            <h2 className="font-display text-xl font-bold">Inventory valuation</h2>
            <p className="text-sm text-ink-500">Current stock snapshot; date filters apply to sales only.</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              downloadCsv(`hcs-inventory-${inventory.scope.generatedAt.slice(0, 10)}.csv`, [
                [
                  'Location',
                  'Product',
                  'Variant',
                  'SKU',
                  'On hand',
                  'Reserved',
                  'Available',
                  'In transit',
                  'Average unit cost',
                  'Valuation',
                ],
                ...inventoryRows,
              ])
            }
          >
            <Download size={16} className="mr-2" />
            CSV
          </Button>
        </div>
        <div className="grid gap-3 border-b border-ink-900/10 p-5 sm:grid-cols-4">
          <Metric label="SKUs" value={inventory.summary.skuCount} />
          <Metric label="Available" value={quantity(inventory.summary.availableMilli)} />
          <Metric label="Out of stock" value={inventory.summary.outOfStockCount} />
          <Metric label="Valuation" value={formatPeso(inventory.summary.valuationCentavos)} />
        </div>
        <ReportTable
          rows={inventory.items.map((item) => [
            <div key="item">
              <strong>{item.productName}</strong>
              <div className="text-xs text-ink-500">
                {item.variantName} · {item.sku}
              </div>
            </div>,
            item.locationName,
            quantity(item.onHandMilli),
            quantity(item.availableMilli),
            formatPeso(item.valuationCentavos),
          ])}
          headings={['Item', 'Location', 'On hand', 'Available', 'Valuation']}
        />
      </Glass>
    </>
  )
}

function Breakdown({ title, rows }: { title: string; rows: SalesReportContext['byCategory'] }) {
  return (
    <Glass variant="light" className="overflow-hidden">
      <div className="border-b border-ink-900/10 p-5">
        <h2 className="font-display text-xl font-bold">{title}</h2>
      </div>
      <ReportTable
        headings={['Name', 'Txns', 'Net sales', 'Gross profit']}
        rows={rows.map((row) => [
          row.label,
          row.transactionCount,
          formatPeso(row.netSalesCentavos),
          formatPeso(row.grossProfitCentavos),
        ])}
      />
    </Glass>
  )
}

function ReportTable({ headings, rows }: { headings: string[]; rows: Array<Array<React.ReactNode>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead>
          <tr className="border-b border-ink-900/10 text-xs uppercase text-ink-500">
            {headings.map((heading, index) => (
              <th key={heading} className={`px-5 py-3 ${index ? 'text-right' : ''}`}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-ink-900/10 last:border-0">
                {row.map((cell, index) => (
                  <td key={index} className={`px-5 py-4 ${index ? 'text-right' : ''}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headings.length} className="px-5 py-10 text-center text-ink-500">
                No activity for this scope.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
