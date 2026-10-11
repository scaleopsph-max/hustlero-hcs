'use client'
import { selectActiveTenant } from '@/lib/active-tenant'
import { createClient } from '@/lib/supabase-browser'
import { statementCsv } from '@/lib/wholesale-statement'
import { sessionContextResponseSchema, wholesaleStatementSchema, type WholesaleStatement } from '@hcs/contracts'
import { formatPeso } from '@hcs/ui'
import { ArrowLeft, Download, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
const api = process.env.NEXT_PUBLIC_API_URL,
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
const field = 'min-w-0 w-full border border-ink-900/20 bg-white p-2'
async function call(path: string, token: string, tenant: string) {
  if (!api) throw new Error('Back Office API is not configured.')
  const response = await fetch(`${api.replace(/\/$/, '')}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenant },
  })
  const data: unknown = await response.json()
  if (!response.ok)
    throw new Error((data as { error?: { message?: string } }).error?.message ?? 'Could not load statement.')
  return data
}
export function WholesaleStatementsWorkspace() {
  const [auth] = useState(() => (supabaseUrl && key ? createClient(supabaseUrl, key) : null)),
    [scope, setScope] = useState<{ user: string; tenant: string } | null>(null),
    [report, setReport] = useState<WholesaleStatement | null>(null),
    [options, setOptions] = useState<{
      customers: WholesaleStatement['customers']
      locations: WholesaleStatement['locations']
    }>({ customers: [], locations: [] }),
    [date, setDate] = useState(today),
    [customer, setCustomer] = useState(''),
    [location, setLocation] = useState(''),
    [busy, setBusy] = useState(true),
    [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        if (!auth) throw new Error('Authentication is not configured.')
        const { data, error: sessionError } = await auth.auth.getSession()
        if (sessionError) throw sessionError
        if (!data.session) throw new Error('Sign in to view statements.')
        const session = sessionContextResponseSchema.parse(await call('/v1/me', data.session.access_token, ''))
        const tenant = selectActiveTenant(session.tenants)
        if (!tenant) throw new Error('Select a business first.')
        if (active) setScope({ user: data.session.user.id, tenant: tenant.tenantId })
        const next = wholesaleStatementSchema.parse(
          await call(`/v1/wholesale/statements?asOf=${today()}`, data.session.access_token, tenant.tenantId),
        )
        if (active) {
          setReport(next)
          setOptions(next)
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load statement.')
      } finally {
        if (active) setBusy(false)
      }
    })()
    return () => {
      active = false
    }
  }, [auth])
  async function refresh(event: FormEvent) {
    event.preventDefault()
    if (!auth || !scope || lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    setReport(null)
    try {
      const { data, error: sessionError } = await auth.auth.getSession()
      if (sessionError) throw sessionError
      if (!data.session || data.session.user.id !== scope.user) throw new Error('Sign in to the original account.')
      const query = new URLSearchParams({ asOf: date })
      if (customer) query.set('customerId', customer)
      if (location) query.set('locationId', location)
      const next = wholesaleStatementSchema.parse(
        await call(`/v1/wholesale/statements?${query}`, data.session.access_token, scope.tenant),
      )
      setReport(next)
      setOptions(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load statement.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  function download() {
    if (!report) return
    const url = URL.createObjectURL(new Blob([statementCsv(report)], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `wholesale-statement-${report.scope.asOfDate}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  return (
    <section className="min-w-0 space-y-4">
      <div className="flex flex-wrap justify-between gap-3 print:hidden">
        <Link href="/wholesale" className="inline-flex items-center gap-2 text-sm">
          <ArrowLeft size={18} />
          Orders
        </Link>
        <div className="flex gap-2">
          <button
            title="Export CSV"
            aria-label="Export CSV"
            disabled={!report || busy}
            onClick={download}
            className="border border-ink-900/20 bg-white p-2 disabled:opacity-40"
          >
            <Download size={18} />
          </button>
        </div>
      </div>
      <form onSubmit={refresh} className="grid items-end gap-3 text-sm sm:grid-cols-4 print:hidden">
        <label className="space-y-1">
          <span>As-of date</span>
          <input
            type="date"
            required
            className={field}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <label className="min-w-0 space-y-1">
          <span>Customer</span>
          <select
            aria-label="Customer"
            className={field}
            value={customer}
            onChange={(event) => setCustomer(event.target.value)}
          >
            <option value="">All customers</option>
            {options.customers.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 space-y-1">
          <span>Location</span>
          <select
            aria-label="Location"
            className={field}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          >
            <option value="">All locations</option>
            {options.locations.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={busy || !scope}
          className="flex justify-center gap-2 border border-ink-900/20 bg-white p-2 disabled:opacity-40"
        >
          <RefreshCw size={18} />
          Apply
        </button>
      </form>
      {error && (
        <p role="alert" className="border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {busy ? (
        <p>Loading statement...</p>
      ) : (
        report && (
          <>
            <p className="break-words text-xs text-ink-500">
              As of {report.scope.asOf} · {report.scope.timezone} · Customer:{' '}
              {report.scope.customerId
                ? report.customers.find((row) => row.id === report.scope.customerId)?.name
                : 'All'}{' '}
              · Location:{' '}
              {report.scope.locationId
                ? report.locations.find((row) => row.id === report.scope.locationId)?.name
                : 'All'}
            </p>
            {report.summary.unclassifiedCount > 0 && (
              <p role="status" className="border-l-2 border-amber-500 bg-amber-50 p-3 text-sm">
                {report.summary.unclassifiedCount} unclassified invoices ({formatPeso(report.summary.unclassifiedMinor)}
                ). Classified balance is incomplete.
              </p>
            )}
            <dl className="grid grid-cols-2 gap-4 border-y border-ink-900/15 py-4 text-sm sm:grid-cols-3 xl:grid-cols-6">
              {[
                ['Classified balance', report.summary.balanceMinor],
                ['Current', report.summary.currentMinor],
                ['1-30 days', report.summary.days1To30Minor],
                ['31-60 days', report.summary.days31To60Minor],
                ['61-90 days', report.summary.days61To90Minor],
                ['Over 90 days', report.summary.over90Minor],
              ].map(([name, value]) => (
                <div key={name}>
                  <dt className="text-ink-500">{name}</dt>
                  <dd className="mt-1 font-semibold">{formatPeso(value as number)}</dd>
                </div>
              ))}
            </dl>
            <h2 className="font-semibold">Invoice aging</h2>
            <div className="overflow-x-auto border-y border-ink-900/15 bg-white/70">
              <table className="w-full min-w-[850px] text-left text-sm">
                <thead>
                  <tr>
                    {['Invoice', 'Customer / location', 'Due', 'Days overdue', 'Band', 'Charge', 'Paid', 'Balance'].map(
                      (name) => (
                        <th key={name} className="p-3 font-medium">
                          {name}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {report.invoices.map((row) => (
                    <tr key={row.invoiceId} className="border-t border-ink-900/10">
                      <td className="p-3">
                        <Link href={`/sales/${row.saleId}`} className="underline">
                          {row.invoiceNumber}
                        </Link>
                        <span className="block text-xs text-ink-500">{row.classification}</span>
                      </td>
                      <td className="p-3">
                        {row.customerName}
                        <span className="block text-xs text-ink-500">{row.locationName}</span>
                      </td>
                      <td className="p-3">{row.dueDate ?? 'Unknown'}</td>
                      <td className="p-3">{row.daysOverdue ?? 'Unknown'}</td>
                      <td className="p-3">{row.band}</td>
                      <td className="p-3">{row.chargedMinor === null ? 'Unknown' : formatPeso(row.chargedMinor)}</td>
                      <td className="p-3">{formatPeso(row.paidMinor)}</td>
                      <td className="p-3">{row.balanceMinor === null ? 'Unknown' : formatPeso(row.balanceMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!report.invoices.length && <p className="p-4 text-sm">No invoices in this scope.</p>}
            </div>
            <h2 className="font-semibold">Statement entries</h2>
            <div className="overflow-x-auto border-y border-ink-900/15 bg-white/70">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr>
                    {['Recorded', 'Invoice', 'Entry / reference', 'Debit', 'Credit'].map((name) => (
                      <th key={name} className="p-3 font-medium">
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.entries.map((row) => (
                    <tr key={row.entryId} className="border-t border-ink-900/10">
                      <td className="p-3">{row.recordedAt}</td>
                      <td className="p-3">{row.invoiceNumber}</td>
                      <td className="max-w-72 break-words p-3">
                        {row.kind}
                        <span className="block text-xs text-ink-500">{row.reference}</span>
                      </td>
                      <td className="p-3">{formatPeso(row.debitMinor)}</td>
                      <td className="p-3">{formatPeso(row.creditMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!report.entries.length && <p className="p-4 text-sm">No classified statement entries.</p>}
            </div>
          </>
        )
      )}
    </section>
  )
}
