'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import {
  posPaymentReferenceReportSchema,
  sessionContextResponseSchema,
  type PosPaymentReferenceReport,
} from '@hcs/contracts'
import { formatPeso } from '@hcs/ui'
import { createClient } from '@/lib/supabase-browser'
import { selectActiveTenant } from '@/lib/active-tenant'
import { paymentReferenceCsv } from '@/lib/payment-reference-report'

const field = 'min-h-10 min-w-0 w-full rounded border border-ink-900/20 bg-white px-3 py-2'
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
const apiUrl = process.env.NEXT_PUBLIC_API_URL
async function call(path: string, token: string, tenant: string) {
  if (!apiUrl) throw new Error('API is not configured.')
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenant },
  })
  const data: unknown = await response.json()
  if (!response.ok)
    throw new Error((data as { error?: { message?: string } }).error?.message ?? 'Could not load payments.')
  return data
}
export function PaymentReferenceReport() {
  const [auth] = useState(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    return url && key ? createClient(url, key) : null
  })
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [location, setLocation] = useState('')
  const [method, setMethod] = useState('')
  const [report, setReport] = useState<PosPaymentReferenceReport | null>(null)
  const [locations, setLocations] = useState<PosPaymentReferenceReport['locations']>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const scope = useRef<{ user: string; tenant: string } | null>(null)
  const locked = useRef(false)
  const alive = useRef(true)
  async function load(event?: FormEvent) {
    event?.preventDefault()
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError(null)
    setReport(null)
    try {
      if (!auth) throw new Error('Authentication is not configured.')
      const { data, error: sessionError } = await auth.auth.getSession()
      if (sessionError) throw sessionError
      if (!data.session) throw new Error('Sign in to view payments.')
      const session = sessionContextResponseSchema.parse(await call('/v1/me', data.session.access_token, ''))
      const tenant = selectActiveTenant(session.tenants)
      if (!tenant) throw new Error('Select a business first.')
      if (scope.current && (scope.current.user !== data.session.user.id || scope.current.tenant !== tenant.tenantId))
        throw new Error('Business or account changed. Reload this page.')
      scope.current = { user: data.session.user.id, tenant: tenant.tenantId }
      const query = new URLSearchParams({ from, to, channel: 'pos' })
      if (location) query.set('locationId', location)
      const next = posPaymentReferenceReportSchema.parse(
        await call(`/v1/reports/pos-payment-references?${query}`, data.session.access_token, tenant.tenantId),
      )
      if (alive.current) {
        setReport(next)
        setLocations(next.locations)
        setMethod('')
      }
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : 'Could not load payments.')
    } finally {
      locked.current = false
      if (alive.current) setBusy(false)
    }
  }
  useEffect(() => {
    alive.current = true
    void load()
    return () => {
      alive.current = false
    }
    // Initial filters only; subsequent requests are explicit form submissions.
  }, [])
  const rows = report?.rows.filter((row) => !method || row.paymentMethodId === method) ?? []
  const methods = Array.from(new Map((report?.rows ?? []).map((row) => [row.paymentMethodId, row.methodName])))
  const totals = new Map<string, { name: string; amount: number; reversed: number; count: number }>()
  for (const row of rows) {
    const item = totals.get(row.paymentMethodId) ?? { name: row.methodName, amount: 0, reversed: 0, count: 0 }
    item.amount += row.amountMinor
    item.reversed += row.reversedMinor
    item.count++
    totals.set(row.paymentMethodId, item)
  }
  function download() {
    if (!report) return
    const href = URL.createObjectURL(
      new Blob([paymentReferenceCsv({ ...report, rows })], { type: 'text/csv;charset=utf-8' }),
    )
    const link = document.createElement('a')
    link.href = href
    link.download = 'pos-payment-references.csv'
    link.click()
    URL.revokeObjectURL(href)
  }
  return (
    <section className="min-w-0 space-y-5 p-4 md:p-6">
      <form onSubmit={(event) => void load(event)} className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1 text-sm">
          From
          <input
            className={field}
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            required
          />
        </label>
        <label className="grid gap-1 text-sm">
          To
          <input className={field} type="date" value={to} onChange={(event) => setTo(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm">
          Branch
          <select className={field} value={location} onChange={(event) => setLocation(event.target.value)}>
            <option value="">All permitted branches</option>
            {locations.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={busy}
          className={field + ' inline-flex items-center justify-center gap-2 disabled:opacity-50'}
        >
          <RefreshCw size={17} />
          Refresh
        </button>
      </form>
      {error ? (
        <div role="alert" className="border-l-2 border-red-500 bg-red-50 p-3 text-red-800">
          {error}
        </div>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="grid gap-1 text-sm">
          Payment method
          <select
            className={field}
            value={method}
            disabled={!report}
            onChange={(event) => setMethod(event.target.value)}
          >
            <option value="">All methods</option>
            {methods.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={download}
          disabled={!report || busy}
          className="inline-flex min-h-10 items-center gap-2 rounded border border-ink-900/20 px-3 disabled:opacity-50"
        >
          <Download size={17} />
          Export CSV
        </button>
      </div>
      {busy ? <p role="status">Loading payments...</p> : null}
      {report ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {['Method', 'Payments', 'Recorded', 'Reversed', 'Net recorded'].map((label) => (
                    <th className="border-b p-3" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from(totals, ([id, item]) => (
                  <tr key={id}>
                    <td className="p-3">{item.name}</td>
                    <td className="p-3">{item.count}</td>
                    <td className="p-3">{formatPeso(item.amount)}</td>
                    <td className="p-3">{formatPeso(item.reversed)}</td>
                    <td className="p-3">{formatPeso(item.amount - item.reversed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {[
                    'Receipt',
                    'Recorded at',
                    'Branch',
                    'Cashier',
                    'Customer',
                    'Method',
                    'Amount',
                    'Reference',
                    'Settlement',
                  ].map((label) => (
                    <th className="whitespace-nowrap border-b p-3" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.paymentId} className="border-b">
                    <td className="whitespace-nowrap p-3">{row.receiptNumber}</td>
                    <td className="whitespace-nowrap p-3">
                      {new Intl.DateTimeFormat('en-PH', {
                        timeZone: report.timezone,
                        dateStyle: 'short',
                        timeStyle: 'short',
                      }).format(new Date(row.completedAt))}
                    </td>
                    <td className="p-3">{row.locationName}</td>
                    <td className="p-3">{row.cashierName}</td>
                    <td className="p-3">{row.customerName ?? '-'}</td>
                    <td className="p-3">{row.methodName}</td>
                    <td className="p-3">{formatPeso(row.amountMinor)}</td>
                    <td className="whitespace-nowrap p-3">
                      {row.referenceLastFour ? `Ref ${row.referenceLastFour}` : 'Not recorded'}
                    </td>
                    <td className="p-3">Unverified</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length ? <p>No payments in this scope.</p> : null}
        </>
      ) : null}
    </section>
  )
}
