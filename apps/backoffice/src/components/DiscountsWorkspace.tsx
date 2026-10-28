'use client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import {
  retailDiscountCommandSchema,
  retailDiscountContextSchema,
  retailDiscountSchema,
  retailDiscountVersionsSchema,
  sessionContextResponseSchema,
  type RetailDiscount,
  type RetailDiscountCommand,
  type RetailDiscountVersions,
} from '@hcs/contracts'
import { createClient } from '@/lib/supabase-browser'
import { selectActiveTenant } from '@/lib/active-tenant'
import {
  discountCommandMatches,
  discountDecimal,
  discountDefinitivelyRejected,
  parseDiscountValue,
  reconcileDiscount,
  restoreDiscountCommand,
  type PendingDiscount,
} from '@/lib/discount-commands'
import { Topbar } from './Topbar'

const api = process.env.NEXT_PUBLIC_API_URL,
  url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
export function DiscountsWorkspace() {
  const [auth] = useState(() => (url && publishable ? createClient(url, publishable) : null))
  const [scope, setScope] = useState<{ user: string; tenant: string; storage: string } | null>(null)
  const [rows, setRows] = useState<RetailDiscount[] | null>(null),
    [pending, setPending] = useState<PendingDiscount | null>(null)
  const [editing, setEditing] = useState<RetailDiscount | null>(null),
    [history, setHistory] = useState<RetailDiscountVersions | null>(null)
  const [name, setName] = useState(''),
    [kind, setKind] = useState<'fixed' | 'percent'>('fixed'),
    [amount, setAmount] = useState(''),
    [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(true),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [dismissible, setDismissible] = useState(false)
  const lock = useRef(false),
    mounted = useRef(false)
  async function call(token: string, tenant: string, path: string, command?: PendingDiscount) {
    if (!api) throw new Error('Back Office API is not configured.')
    const response = await fetch(`${api.replace(/\/$/, '')}${path}`, {
      method: command ? 'POST' : 'GET',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': tenant,
        ...(command ? { 'Content-Type': 'application/json', 'Idempotency-Key': command.key } : {}),
      },
      ...(command ? { body: JSON.stringify(command.payload) } : {}),
    })
    const value: unknown = await response.json()
    if (!response.ok)
      throw Object.assign(
        new Error((value as { error?: { message?: string } }).error?.message ?? 'Discount request failed.'),
        { code: (value as { error?: { code?: string } }).error?.code },
      )
    return value
  }
  useEffect(() => {
    let active = true
    mounted.current = true
    void (async () => {
      try {
        if (!auth) throw new Error('Authentication is not configured.')
        const session = await auth.auth.getSession()
        if (session.error) throw session.error
        if (!session.data.session) throw new Error('Sign in to manage discounts.')
        const current = session.data.session
        const access = sessionContextResponseSchema.parse(await call(current.access_token, '', '/v1/me'))
        const tenant = selectActiveTenant(access.tenants)
        if (!tenant) throw new Error('Select a business first.')
        const storage = `hcs-discounts:${current.user.id}:${tenant.tenantId}`
        const restored = restoreDiscountCommand(sessionStorage.getItem(storage))
        const data = retailDiscountContextSchema.parse(
          await call(current.access_token, tenant.tenantId, '/v1/discounts'),
        )
        if (active) {
          setScope({ user: current.user.id, tenant: tenant.tenantId, storage })
          setRows(data.discounts)
          setPending(restored)
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load discounts.')
      } finally {
        if (active) setBusy(false)
      }
    })()
    return () => {
      active = false
      mounted.current = false
    }
  }, [auth])
  async function token() {
    if (!auth || !scope) throw new Error('Sign in to the original account.')
    const session = await auth.auth.getSession()
    if (session.error) throw session.error
    if (!session.data.session || session.data.session.user.id !== scope.user)
      throw new Error('Sign in to the original account.')
    return session.data.session.access_token
  }
  function resetForm() {
    setEditing(null)
    setName('')
    setAmount('')
    setKind('fixed')
    setEnabled(false)
  }
  async function run(payload?: RetailDiscountCommand) {
    if (!scope || lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    setDismissible(false)
    setHistory(null)
    try {
      const access = await token()
      const stored = restoreDiscountCommand(sessionStorage.getItem(scope.storage))
      if (pending ? !discountCommandMatches(pending, stored) : stored !== null)
        throw new Error('Saved command changed. Reload to reconcile it.')
      let command = pending
      if (payload || command) {
        command ??= { key: crypto.randomUUID(), payload: retailDiscountCommandSchema.parse(payload) }
        sessionStorage.setItem(scope.storage, JSON.stringify(command))
        setPending(command)
        const result = retailDiscountSchema.parse(await call(access, scope.tenant, '/v1/discounts', command))
        const proof = await call(access, scope.tenant, `/v1/discounts/${result.id}/versions/${result.revision}`)
        reconcileDiscount(command, result, proof)
        const fresh = retailDiscountContextSchema.parse(await call(access, scope.tenant, '/v1/discounts'))
        await token()
        if (
          !mounted.current ||
          !discountCommandMatches(command, restoreDiscountCommand(sessionStorage.getItem(scope.storage)))
        )
          throw new Error('Saved command changed. Reload to reconcile it.')
        sessionStorage.removeItem(scope.storage)
        setPending(null)
        setRows(fresh.discounts)
        resetForm()
        setNotice('Discount saved.')
      } else {
        const fresh = retailDiscountContextSchema.parse(await call(access, scope.tenant, '/v1/discounts'))
        if (mounted.current) setRows(fresh.discounts)
      }
    } catch (cause) {
      if (mounted.current) {
        setDismissible(discountDefinitivelyRejected((cause as { code?: string }).code))
        setError(cause instanceof Error ? cause.message : 'Could not save discount.')
      }
    } finally {
      lock.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function versions(id: string) {
    if (!scope || lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    setHistory(null)
    try {
      const value = retailDiscountVersionsSchema.parse(
        await call(await token(), scope.tenant, `/v1/discounts/${id}/versions`),
      )
      if (value.discountId !== id) throw new Error('Discount history does not match the selected discount.')
      if (mounted.current) setHistory(value)
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not load history.')
    } finally {
      lock.current = false
      if (mounted.current) setBusy(false)
    }
  }
  function dismiss() {
    if (!scope || !pending || !dismissible || lock.current) return
    try {
      if (!discountCommandMatches(pending, restoreDiscountCommand(sessionStorage.getItem(scope.storage))))
        throw new Error('Saved command changed. Reload to reconcile it.')
      sessionStorage.removeItem(scope.storage)
      setPending(null)
      setDismissible(false)
      setError(null)
      setRows(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reconcile command.')
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    try {
      const value = parseDiscountValue(kind, amount),
        status = enabled ? ('active' as const) : ('inactive' as const)
      void run(
        retailDiscountCommandSchema.parse(
          editing
            ? { action: 'update', discountId: editing.id, expectedRevision: editing.revision, name, value, status }
            : { action: 'create', name, value, status },
        ),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Check the discount details.')
    }
  }
  const disabled = busy || !!pending
  return (
    <>
      <Topbar
        title="Discounts"
        subtitle="Predefined discounts for untaxed retail tickets."
        actions={
          <button
            type="button"
            disabled={disabled || !scope}
            onClick={() => void run()}
            className="text-sm font-semibold underline disabled:opacity-50"
          >
            Refresh discounts
          </button>
        }
      />
      <Link href="/products" className="inline-block py-3 text-sm font-semibold underline">
        Products
      </Link>
      {error && (
        <p role="alert" className="border-l-2 border-red-500 bg-red-50 p-3">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="border-l-2 border-emerald-600 bg-emerald-50 p-3">
          {notice}
        </p>
      )}
      {pending && (
        <div className="flex flex-wrap items-center gap-3 border-y border-ink-900/15 py-3">
          <span>Pending {pending.payload.action}</span>
          <button type="button" disabled={busy} onClick={() => void run()} className="underline">
            Retry original command
          </button>
          {dismissible && (
            <button type="button" disabled={busy} onClick={dismiss} className="underline">
              Dismiss rejected command
            </button>
          )}
        </div>
      )}
      {scope && !pending && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3 border-b border-ink-900/15 py-4">
          <label className="min-w-48 flex-1 basis-full text-sm sm:basis-48">
            Discount name
            <input
              required
              maxLength={80}
              disabled={disabled}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block min-h-11 w-full rounded border border-ink-900/20 bg-white px-3"
            />
          </label>
          <label className="text-sm">
            Type
            <select
              aria-label="Discount type"
              disabled={disabled}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as 'fixed' | 'percent')
                setAmount('')
              }}
              className="mt-1 block min-h-11 rounded border border-ink-900/20 bg-white px-3"
            >
              <option value="fixed">Fixed amount</option>
              <option value="percent">Percentage</option>
            </select>
          </label>
          <label className="text-sm">
            {kind === 'fixed' ? 'Amount (PHP)' : 'Percent'}
            <input
              required
              inputMode="decimal"
              disabled={disabled}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 block min-h-11 w-36 rounded border border-ink-900/20 bg-white px-3"
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={disabled}
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Active
          </label>
          <button disabled={disabled} className="min-h-11 rounded bg-ink-900 px-4 text-white disabled:opacity-50">
            {editing ? 'Save discount' : 'Add discount'}
          </button>
          {editing && (
            <button type="button" disabled={disabled} onClick={resetForm} className="min-h-11 px-3 underline">
              Cancel edit
            </button>
          )}
        </form>
      )}
      {rows && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-900/15">
                {['Discount', 'Value', 'Status', 'Revision', 'Actions'].map((label) => (
                  <th key={label} className="p-3">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-900/10">
                  <td className="max-w-64 break-words p-3 font-semibold">{row.name}</td>
                  <td className="whitespace-nowrap p-3">
                    {row.value.kind === 'fixed'
                      ? `PHP ${discountDecimal(row.value.amountMinor)}`
                      : `${discountDecimal(row.value.rateBps)}%`}
                  </td>
                  <td className="p-3">{row.status}</td>
                  <td className="p-3">{row.revision}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={disabled || row.status === 'archived'}
                        onClick={() => {
                          setEditing(row)
                          setName(row.name)
                          setKind(row.value.kind)
                          setAmount(
                            discountDecimal(row.value.kind === 'fixed' ? row.value.amountMinor : row.value.rateBps),
                          )
                          setEnabled(row.status === 'active')
                        }}
                        className="underline disabled:opacity-40"
                        aria-label={`Edit ${row.name}`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={disabled || row.status === 'archived'}
                        onClick={() => {
                          if (window.confirm(`Archive ${row.name}? Historical versions will be kept.`))
                            void run({ action: 'archive', discountId: row.id, expectedRevision: row.revision })
                        }}
                        className="underline disabled:opacity-40"
                        aria-label={`Archive ${row.name}`}
                      >
                        Archive
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => void versions(row.id)}
                        className="underline disabled:opacity-40"
                        aria-label={`History ${row.name}`}
                      >
                        History
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-8 text-center text-ink-500">No discounts configured.</p>}
        </div>
      )}
      {history && (
        <section className="my-4 border-t border-ink-900/15 py-4">
          <h2 className="font-semibold">Discount history</h2>
          <p className="text-sm text-ink-500">Latest 100 versions</p>
          <ol>
            {history.versions.map((version) => (
              <li key={version.revision} className="break-words border-b border-ink-900/10 py-3 text-sm">
                Revision {version.revision}: {version.name},{' '}
                {version.value.kind === 'fixed'
                  ? `PHP ${discountDecimal(version.value.amountMinor)}`
                  : `${discountDecimal(version.value.rateBps)}%`}
                , {version.status}{' '}
                <time dateTime={version.updatedAt}>{new Date(version.updatedAt).toLocaleString()}</time>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  )
}
