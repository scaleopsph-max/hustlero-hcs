'use client'
import { selectActiveTenant } from '@/lib/active-tenant'
import { createClient } from '@/lib/supabase-browser'
import { settlementCsv } from '@/lib/wholesale-settlement'
import {
  sessionContextResponseSchema,
  wholesaleSettlementReportSchema,
  type WholesaleSettlementReport,
} from '@hcs/contracts'
import { formatPeso } from '@hcs/ui'
import { ArrowLeft, Download, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState, useRef, type FormEvent } from 'react'
const apiUrl = process.env.NEXT_PUBLIC_API_URL
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const field = 'min-w-0 w-full rounded border border-ink-900/20 bg-white px-3 py-2'
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
async function call(path: string, token: string, tenant: string) {
  if (!apiUrl) throw new Error('Back Office API is not configured.')
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenant },
  })
  const data: unknown = await response.json()
  if (!response.ok)
    throw new Error((data as { error?: { message?: string } }).error?.message ?? 'Could not load settlement report.')
  return data
}
export function WholesaleSettlementWorkspace() {
  const [auth] = useState(() => (supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null))
  const [scope, setScope] = useState<{ tenant: string; user: string } | null>(null)
  const [from, setFrom] = useState(today),
    [to, setTo] = useState(today),
    [location, setLocation] = useState('')
  const [report, setReport] = useState<WholesaleSettlementReport | null>(null)
  const [locations, setLocations] = useState<WholesaleSettlementReport['locations']>([])
  const [busy, setBusy] = useState(true),
    [error, setError] = useState<string | null>(null)
  const locked = useRef(false)
  useEffect(() => {
    let active = true
    async function initialize() {
      try {
        if (!auth) throw new Error('Authentication is not configured.')
        const { data, error: sessionError } = await auth.auth.getSession()
        if (sessionError) throw sessionError
        if (!data.session) throw new Error('Sign in to view wholesale reports.')
        const session = sessionContextResponseSchema.parse(await call('/v1/me', data.session.access_token, ''))
        const tenant = selectActiveTenant(session.tenants)
        if (!tenant) throw new Error('Select a business first.')
        const date = today()
        const next = wholesaleSettlementReportSchema.parse(
          await call(
            `/v1/reports/wholesale-settlement?from=${date}&to=${date}&channel=wholesale`,
            data.session.access_token,
            tenant.tenantId,
          ),
        )
        if (active) {
          setScope({ tenant: tenant.tenantId, user: data.session.user.id })
          setReport(next)
          setLocations(next.locations)
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load report.')
      } finally {
        if (active) setBusy(false)
      }
    }
    void initialize()
    return () => {
      active = false
    }
  }, [auth])
  async function load(event: FormEvent) {
    event.preventDefault()
    if (!auth || !scope || locked.current) return
    locked.current = true
    setBusy(true)
    setError(null)
    setReport(null)
    try {
      const { data, error: sessionError } = await auth.auth.getSession()
      if (sessionError) throw sessionError
      if (!data.session || data.session.user.id !== scope.user) throw new Error('Sign in to the original account.')
      const query = new URLSearchParams({ from, to, channel: 'wholesale' })
      if (location) query.set('locationId', location)
      const next = wholesaleSettlementReportSchema.parse(
        await call(`/v1/reports/wholesale-settlement?${query}`, data.session.access_token, scope.tenant),
      )
      setReport(next)
      setLocations(next.locations)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load report.')
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  function download() {
    if (!report) return
    const href = URL.createObjectURL(new Blob([settlementCsv(report)], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = href
    link.download = `wholesale-settlement-${report.scope.from}-${report.scope.to}.csv`
    link.click()
    URL.revokeObjectURL(href)
  }
  const cards = report
    ? [
        ['Issued invoices', formatPeso(report.summary.issuedMinor)],
        ['Recorded receipts', formatPeso(report.summary.recordedReceiptsMinor)],
        ['Opening charges', formatPeso(report.summary.openingChargesMinor)],
        ['Closing classified balance', formatPeso(report.summary.closingReceivablesMinor)],
      ]
    : []
  return (
    <div className="min-w-0 space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/wholesale/payments" className="inline-flex items-center gap-2">
          <ArrowLeft size={18} />
          Payments
        </Link>
        <button
          type="button"
          onClick={download}
          disabled={!report || busy}
          className="inline-flex min-h-10 items-center gap-2 rounded border border-ink-900/20 px-3 py-2 disabled:opacity-50"
        >
          <Download size={18} />
          Export CSV
        </button>
      </div>
      <form
        onSubmit={(event) => void load(event)}
        className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr_auto]"
      >
        <label className="space-y-1">
          <span>From</span>
          <input
            type="date"
            className={field}
            value={from}
            disabled={busy}
            onChange={(event) => setFrom(event.target.value)}
            required
          />
        </label>
        <label className="space-y-1">
          <span>To</span>
          <input
            type="date"
            className={field}
            min={from}
            value={to}
            disabled={busy}
            onChange={(event) => setTo(event.target.value)}
            required
          />
        </label>
        <label className="space-y-1">
          <span>Location</span>
          <select
            aria-label="Location"
            className={field}
            value={location}
            disabled={busy}
            onChange={(event) => setLocation(event.target.value)}
          >
            <option value="">All locations</option>
            {locations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          title="Apply report filters"
          aria-label="Apply report filters"
          disabled={busy || !scope}
          className="grid size-10 place-items-center rounded border border-ink-900/20 disabled:opacity-50"
        >
          <RefreshCw size={18} />
        </button>
      </form>
      {error && (
        <p role="alert" className="border-l-2 border-red-500 bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {busy && <p role="status">Loading settlement report...</p>}
      {report && (
        <>
          <p className="text-sm text-ink-500">
            {report.scope.from} to {report.scope.to} · {report.scope.timezone} · As of{' '}
            {new Date(report.scope.asOf).toLocaleString('en-PH', { timeZone: report.scope.timezone })}
          </p>
          {report.summary.unclassifiedCount > 0 && (
            <p role="alert" className="border-l-2 border-amber-500 bg-amber-50 p-3">
              Incomplete receivables: {report.summary.unclassifiedCount} unclassified invoices (
              {formatPeso(report.summary.unclassifiedMinor)}).
            </p>
          )}
          <dl className="grid gap-4 border-y border-ink-900/15 py-5 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-sm text-ink-500">{label}</dt>
                <dd className="mt-2 break-words text-2xl font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          <section>
            <h2 className="mb-4 text-xl font-semibold">Recorded receipts by payment method</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[400px] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-900/15">
                    <th className="py-3">Method</th>
                    <th>Receipts</th>
                    <th className="text-right">Allocated amount</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byPaymentMethod.map((item) => (
                    <tr key={item.id} className="border-b border-ink-900/10">
                      <td className="py-3">{item.name}</td>
                      <td>{item.receiptCount}</td>
                      <td className="text-right font-semibold">{formatPeso(item.amountMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!report.byPaymentMethod.length && (
              <p className="py-3 text-ink-500">No recorded receipts in this period.</p>
            )}
          </section>
        </>
      )}
    </div>
  )
}
