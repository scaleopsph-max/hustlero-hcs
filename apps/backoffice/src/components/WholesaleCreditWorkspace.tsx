'use client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, RefreshCw, Save } from 'lucide-react'
import {
  sessionContextResponseSchema,
  wholesaleCreditSettingsContextSchema,
  wholesaleReceivablesContextSchema,
  type WholesaleCreditSettingsContext,
  type WholesaleReceivablesContext,
} from '@hcs/contracts'
import { formatPeso } from '@hcs/ui'
import { createClient } from '@/lib/supabase-browser'
import { selectActiveTenant } from '@/lib/active-tenant'
import { paymentMoneyInput } from '@/lib/wholesale-payment'
import {
  restoreCreditCommand,
  refreshConfirmedCreditCommand,
  prepareCreditSettings,
  prepareOpeningReceivable,
  creditCommandDefinitivelyRejected,
  type PendingCreditCommand,
} from '@/lib/wholesale-credit-commands'

const api = process.env.NEXT_PUBLIC_API_URL,
  url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const field = 'w-full min-w-0 rounded border border-ink-900/20 bg-white px-3 py-2'
const terms = [
  ['prepaid', 'Prepaid'],
  ['cod', 'Cash on delivery'],
  ['net_7', 'Net 7'],
  ['net_15', 'Net 15'],
  ['net_30', 'Net 30'],
] as const
async function call(path: string, token: string, tenant: string, command?: PendingCreditCommand) {
  if (!api) throw new Error('Back Office API is not configured.')
  const response = await fetch(`${api.replace(/\/$/, '')}${path}`, {
    method: command ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-Id': tenant,
      ...(command ? { 'Content-Type': 'application/json', 'Idempotency-Key': command.key } : {}),
    },
    ...(command ? { body: JSON.stringify(command.payload) } : {}),
  })
  const result: unknown = await response.json()
  if (!response.ok)
    throw Object.assign(
      new Error((result as { error?: { message?: string } }).error?.message ?? 'Could not load wholesale credit.'),
      { code: (result as { error?: { code?: string } }).error?.code },
    )
  return result
}

export function WholesaleCreditWorkspace() {
  const [auth] = useState(() => (url && key ? createClient(url, key) : null))
  const [scope, setScope] = useState<{ user: string; tenant: string; storage: string } | null>(null)
  const [settings, setSettings] = useState<WholesaleCreditSettingsContext | null>(null),
    [receivables, setReceivables] = useState<WholesaleReceivablesContext | null>(null)
  const [customer, setCustomer] = useState(''),
    [term, setTerm] = useState(''),
    [limit, setLimit] = useState(''),
    [settingsReason, setSettingsReason] = useState('')
  const [invoice, setInvoice] = useState(''),
    [due, setDue] = useState(''),
    [openingReason, setOpeningReason] = useState(''),
    [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState<PendingCreditCommand | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null)
  const locked = useRef(false),
    mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  async function load(token: string, tenant: string) {
    const nextSettings = wholesaleCreditSettingsContextSchema.parse(
      await call('/v1/wholesale/credit-settings', token, tenant),
    )
    const nextReceivables = wholesaleReceivablesContextSchema.parse(
      await call('/v1/wholesale/receivables', token, tenant),
    )
    return { settings: nextSettings, receivables: nextReceivables }
  }
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        if (!auth) throw new Error('Authentication is not configured.')
        const { data, error: sessionError } = await auth.auth.getSession()
        if (sessionError) throw sessionError
        if (!data.session) throw new Error('Sign in to view wholesale credit.')
        const access = sessionContextResponseSchema.parse(await call('/v1/me', data.session.access_token, ''))
        const tenant = selectActiveTenant(access.tenants)
        if (!tenant) throw new Error('Select a business first.')
        const storage = `hcs-wholesale-credit:${data.session.user.id}:${tenant.tenantId}`
        const stored = sessionStorage.getItem(storage)
        const restored = restoreCreditCommand(stored)
        if (active) {
          setScope({ user: data.session.user.id, tenant: tenant.tenantId, storage })
          setPending(restored)
        }
        const next = await load(data.session.access_token, tenant.tenantId)
        if (active) {
          setSettings(next.settings)
          setReceivables(next.receivables)
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load wholesale credit.')
      } finally {
        if (active) setBusy(false)
      }
    })()
    return () => {
      active = false
    }
  }, [auth])
  async function currentSession() {
    if (!auth || !scope) throw new Error('Sign in to the original account.')
    const { data, error: sessionError } = await auth.auth.getSession()
    if (sessionError) throw sessionError
    if (!data.session || data.session.user.id !== scope.user) throw new Error('Sign in to the original account.')
    return data.session
  }
  async function refresh() {
    if (!scope || locked.current) return
    locked.current = true
    setBusy(true)
    setError(null)
    setMessage(null)
    setSettings(null)
    setReceivables(null)
    try {
      const session = await currentSession(),
        next = await load(session.access_token, scope.tenant)
      if (mounted.current) {
        setSettings(next.settings)
        setReceivables(next.receivables)
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not refresh credit.')
    } finally {
      locked.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function submit(kind: PendingCreditCommand['kind'], event?: FormEvent) {
    event?.preventDefault()
    if (!scope || locked.current || (pending && pending.kind !== kind)) return
    if (kind === 'settings' ? !settings?.canManage : !receivables?.canRecordOpening) return
    locked.current = true
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const session = await currentSession()
      let command = pending
      if (!command) {
        command =
          kind === 'settings'
            ? {
                kind,
                key: crypto.randomUUID(),
                payload: prepareCreditSettings(settings!, customer, term, limit, settingsReason),
              }
            : {
                kind,
                key: crypto.randomUUID(),
                payload: prepareOpeningReceivable(receivables!, invoice, due, openingReason, confirmed),
              }
        sessionStorage.setItem(scope.storage, JSON.stringify(command))
        setPending(command)
      }
      const next = await refreshConfirmedCreditCommand(
        command,
        await call(
          kind === 'settings' ? '/v1/wholesale/credit-settings' : '/v1/wholesale/receivables/opening',
          session.access_token,
          scope.tenant,
          command,
        ),
        async () => {
          if (mounted.current) {
            setSettings(null)
            setReceivables(null)
          }
          return load(session.access_token, scope.tenant)
        },
      )
      sessionStorage.removeItem(scope.storage)
      if (!mounted.current) return
      setPending(null)
      setConfirmed(false)
      setSettingsReason('')
      setOpeningReason('')
      setMessage(
        kind === 'settings'
          ? 'Credit settings revision saved.'
          : 'Unpaid opening receivable recorded. No new sale or payment was created.',
      )
      setSettings(next.settings)
      setReceivables(next.receivables)
    } catch (cause) {
      if (creditCommandDefinitivelyRejected(kind, (cause as { code?: string }).code)) {
        sessionStorage.removeItem(scope.storage)
        if (mounted.current) setPending(null)
      }
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : 'Command failed. Retry the original request.')
    } finally {
      locked.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const selectedInvoice = receivables?.invoices.find((row) => row.invoiceId === invoice)
  return (
    <section className="min-w-0 space-y-6 p-4 md:p-6">
      <div className="flex justify-between gap-3">
        <Link href="/wholesale" className="inline-flex items-center gap-2 text-sm">
          <ArrowLeft size={18} />
          Orders
        </Link>
        <button
          title="Refresh credit context"
          aria-label="Refresh credit context"
          onClick={() => void refresh()}
          disabled={busy || !scope}
          className="border border-ink-900/20 bg-white p-2 disabled:opacity-40"
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {error && (
        <p role="alert" className="border-l-2 border-red-500 bg-red-50 p-3 text-sm">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="border-l-2 border-emerald-500 bg-emerald-50 p-3 text-sm">
          {message}
        </p>
      )}
      {busy && <p role="status">Loading wholesale credit...</p>}
      {pending && (
        <div className="space-y-2 border-l-2 border-amber-500 bg-amber-50 p-3 text-sm">
          <p>
            Pending {pending.kind === 'settings' ? 'credit settings' : 'opening receivable'}:{' '}
            {pending.kind === 'settings' ? pending.payload.customerId : pending.payload.invoiceId}
          </p>
          <p className="break-words">
            {pending.kind === 'settings'
              ? `${pending.payload.paymentTerm} / ${formatPeso(pending.payload.creditLimitMinor)}`
              : `Due ${pending.payload.dueDate}`}{' '}
            / {pending.payload.reason}
          </p>
          <button
            onClick={() => void submit(pending.kind)}
            disabled={busy || (pending.kind === 'settings' ? !settings?.canManage : !receivables?.canRecordOpening)}
            className="inline-flex items-center gap-2 border border-ink-900/20 bg-white p-2 disabled:opacity-40"
          >
            <RefreshCw size={18} />
            Retry original request
          </button>
        </div>
      )}
      {settings && (
        <>
          <h2 className="text-lg font-semibold">Customer terms and credit</h2>
          <div className="overflow-x-auto border-y border-ink-900/15 bg-white/70">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead>
                <tr>
                  {['Customer', 'Payment terms', 'Credit limit', 'Revision'].map((name) => (
                    <th key={name} className="p-3 font-medium">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {settings.customers.map((row) => (
                  <tr key={row.customerId} className="border-t border-ink-900/10">
                    <td className="p-3">
                      {row.customerName}
                      <span className="block text-xs text-ink-500">{row.customerNumber}</span>
                    </td>
                    <td className="p-3">
                      {row.settings
                        ? terms.find(([value]) => value === row.settings?.paymentTerm)?.[1]
                        : 'Not configured'}
                    </td>
                    <td className="p-3">
                      {row.settings ? formatPeso(row.settings.creditLimitMinor) : 'Not configured'}
                    </td>
                    <td className="p-3">{row.settings?.revision ?? 'Not configured'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!settings.customers.length && <p className="p-4 text-sm">No active resellers.</p>}
          </div>
          <form onSubmit={(event) => void submit('settings', event)} className="max-w-3xl space-y-3">
            <fieldset
              disabled={busy || !!pending || !settings.canManage}
              className="min-w-0 space-y-3 disabled:opacity-60"
            >
              <label className="block space-y-1">
                <span>Customer</span>
                <select
                  aria-label="Credit customer"
                  className={field}
                  value={customer}
                  required
                  onChange={(event) => {
                    const row = settings.customers.find((item) => item.customerId === event.target.value)
                    setCustomer(event.target.value)
                    setTerm(row?.settings?.paymentTerm ?? '')
                    setLimit(row?.settings ? paymentMoneyInput(row.settings.creditLimitMinor) : '')
                    setSettingsReason('')
                  }}
                >
                  <option value="">Select reseller</option>
                  {settings.customers.map((row) => (
                    <option key={row.customerId} value={row.customerId}>
                      {row.customerName} ({row.customerNumber})
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="min-w-0 space-y-1">
                  <span>Payment terms</span>
                  <select
                    aria-label="Payment terms"
                    className={field}
                    value={term}
                    required
                    onChange={(event) => setTerm(event.target.value)}
                  >
                    <option value="">Select terms</option>
                    {terms.map(([value, name]) => (
                      <option key={value} value={value}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="min-w-0 space-y-1">
                  <span>Credit limit (PHP)</span>
                  <input
                    className={field}
                    inputMode="decimal"
                    value={limit}
                    required
                    onChange={(event) => setLimit(event.target.value)}
                  />
                </label>
              </div>
              <label className="block space-y-1">
                <span>Settings reason</span>
                <textarea
                  className={field}
                  value={settingsReason}
                  required
                  minLength={2}
                  maxLength={500}
                  onChange={(event) => setSettingsReason(event.target.value)}
                />
              </label>
            </fieldset>
            <button
              type="submit"
              disabled={busy || !!pending || !settings.canManage || !settings.customers.length}
              className="inline-flex items-center gap-2 border border-ink-900/20 bg-white p-2 disabled:opacity-40"
            >
              <Save size={18} />
              Save credit revision
            </button>
            {!settings.canManage && <p className="text-sm text-ink-500">Read-only credit settings.</p>}
          </form>
        </>
      )}
      {receivables && (
        <>
          <h2 className="border-t border-ink-900/15 pt-5 text-lg font-semibold">Historical opening receivables</h2>
          <div className="overflow-x-auto border-y border-ink-900/15 bg-white/70">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead>
                <tr>
                  {['Invoice', 'Customer / location', 'Original total', 'Classification', 'Open balance'].map(
                    (name) => (
                      <th key={name} className="p-3 font-medium">
                        {name}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {receivables.invoices.map((row) => (
                  <tr key={row.invoiceId} className="border-t border-ink-900/10">
                    <td className="p-3">{row.invoiceNumber}</td>
                    <td className="p-3">
                      {row.customerName}
                      <span className="block text-xs text-ink-500">{row.locationName}</span>
                    </td>
                    <td className="p-3">{formatPeso(row.totalMinor)}</td>
                    <td className="p-3">{row.classification}</td>
                    <td className="p-3">
                      {row.openBalanceMinor === null ? 'Unknown' : formatPeso(row.openBalanceMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!receivables.invoices.length && <p className="p-4 text-sm">No wholesale invoices.</p>}
          </div>
          <form onSubmit={(event) => void submit('opening', event)} className="max-w-3xl space-y-3">
            <fieldset
              disabled={busy || !!pending || !receivables.canRecordOpening}
              className="min-w-0 space-y-3 disabled:opacity-60"
            >
              <label className="block space-y-1">
                <span>Legacy invoice</span>
                <select
                  aria-label="Legacy invoice"
                  className={field}
                  value={invoice}
                  required
                  onChange={(event) => {
                    setInvoice(event.target.value)
                    setConfirmed(false)
                    setDue('')
                    setOpeningReason('')
                  }}
                >
                  <option value="">Select eligible invoice</option>
                  {receivables.invoices
                    .filter(
                      (row) => row.eligibleForOpening && row.classification === 'unclassified' && row.totalMinor > 0,
                    )
                    .map((row) => (
                      <option key={row.invoiceId} value={row.invoiceId}>
                        {row.invoiceNumber} / {row.customerName} / {formatPeso(row.totalMinor)}
                      </option>
                    ))}
                </select>
              </label>
              {selectedInvoice && (
                <p className="text-sm">
                  Original unpaid invoice amount: <strong>{formatPeso(selectedInvoice.totalMinor)}</strong>
                </p>
              )}
              <label className="block space-y-1">
                <span>Opening due date</span>
                <input
                  type="date"
                  className={field}
                  value={due}
                  required
                  onChange={(event) => setDue(event.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span>Opening reason</span>
                <textarea
                  className={field}
                  value={openingReason}
                  required
                  minLength={2}
                  maxLength={500}
                  onChange={(event) => setOpeningReason(event.target.value)}
                />
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  required
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>I confirm this original invoice is unpaid and approve recording its opening receivable.</span>
              </label>
            </fieldset>
            <button
              type="submit"
              disabled={busy || !!pending || !receivables.canRecordOpening || !selectedInvoice?.eligibleForOpening}
              className="inline-flex items-center gap-2 border border-ink-900/20 bg-white p-2 disabled:opacity-40"
            >
              <Check size={18} />
              Record unpaid opening
            </button>
            {!receivables.canRecordOpening && (
              <p className="text-sm text-ink-500">Only an active owner may record opening receivables.</p>
            )}
          </form>
        </>
      )}
    </section>
  )
}
