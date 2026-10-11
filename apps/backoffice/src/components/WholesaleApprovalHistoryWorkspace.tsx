'use client'
import { selectActiveTenant } from '@/lib/active-tenant'
import { createClient } from '@/lib/supabase-browser'
import {
  sessionContextResponseSchema,
  wholesaleCreditOverridesContextSchema,
  type WholesaleCreditOverridesContext,
} from '@hcs/contracts'
import { formatPeso } from '@hcs/ui'
import { ArrowLeft, RefreshCw, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
const apiUrl = process.env.NEXT_PUBLIC_API_URL,
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const date = (value: string) =>
  new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
async function call(path: string, token: string, tenant: string) {
  if (!apiUrl) throw new Error('Back Office API is not configured.')
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenant },
  })
  const data: unknown = await response.json()
  if (!response.ok)
    throw new Error((data as { error?: { message?: string } }).error?.message ?? 'Could not load approval history.')
  return data
}
export function WholesaleApprovalHistoryWorkspace() {
  const [auth] = useState(() => (supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null))
  const [scope, setScope] = useState<{ tenant: string; user: string } | null>(null),
    [history, setHistory] = useState<WholesaleCreditOverridesContext | null>(null),
    [status, setStatus] = useState('all'),
    [search, setSearch] = useState(''),
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
        if (!data.session) throw new Error('Sign in to view approval history.')
        const session = sessionContextResponseSchema.parse(await call('/v1/me', data.session.access_token, ''))
        const tenant = selectActiveTenant(session.tenants)
        if (!tenant) throw new Error('Select a business first.')
        if (active) setScope({ tenant: tenant.tenantId, user: data.session.user.id })
        const next = wholesaleCreditOverridesContextSchema.parse(
          await call('/v1/wholesale/credit-overrides', data.session.access_token, tenant.tenantId),
        )
        if (active) {
          setHistory(next)
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load approval history.')
      } finally {
        if (active) setBusy(false)
      }
    })()
    return () => {
      active = false
    }
  }, [auth])
  async function refresh() {
    if (!auth || !scope || lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    setHistory(null)
    try {
      const { data, error: sessionError } = await auth.auth.getSession()
      if (sessionError) throw sessionError
      if (!data.session || data.session.user.id !== scope.user) throw new Error('Sign in to the original account.')
      setHistory(
        wholesaleCreditOverridesContextSchema.parse(
          await call('/v1/wholesale/credit-overrides', data.session.access_token, scope.tenant),
        ),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load approval history.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const rows =
    history?.overrides.filter(
      (row) =>
        (status === 'all' || row.status === status) &&
        `${row.orderNumber} ${row.reason}`.toLowerCase().includes(search.trim().toLowerCase()),
    ) ?? []
  return (
    <section className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/wholesale" className="inline-flex items-center gap-2 text-sm">
          <ArrowLeft size={18} />
          Orders
        </Link>
        {history?.canApprove && (
          <Link href="/wholesale/approvals/manage" className="inline-flex items-center gap-2 text-sm">
            <ShieldCheck size={18} />
            Manage exceptions
          </Link>
        )}
        <button
          type="button"
          title="Refresh approval history"
          aria-label="Refresh approval history"
          disabled={busy || !scope}
          onClick={refresh}
          className="border border-ink-900/20 bg-white p-2 disabled:opacity-40"
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {error && (
        <div role="alert" className="border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 space-y-1 text-sm">
          <span>Search order or reason</span>
          <input
            className="w-full border border-ink-900/20 bg-white p-2"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>Status</span>
          <select
            aria-label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="w-full border border-ink-900/20 bg-white p-2"
          >
            {['all', 'approved', 'revoked', 'expired', 'consumed'].map((value) => (
              <option key={value} value={value}>
                {value === 'all' ? 'All statuses' : value[0]?.toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {busy ? (
        <p className="p-4 text-sm">Loading approval history...</p>
      ) : (
        history && (
          <>
            <p className="text-xs text-ink-500">
              As of {date(history.asOf)} · {rows.length} records
            </p>
            <div className="space-y-0 border-y border-ink-900/15 bg-white/70">
              {rows.length ? (
                rows.map((row) => (
                  <article
                    key={row.overrideId}
                    className="min-w-0 space-y-3 border-b border-ink-900/10 p-4 last:border-0"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <h2 className="font-semibold">
                        {row.orderNumber} · {row.action === 'confirm' ? 'Confirmation' : 'Fulfillment'}
                      </h2>
                      <span className="text-sm font-semibold capitalize">{row.status}</span>
                    </div>
                    <dl className="grid gap-3 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-ink-500">Approved excess</dt>
                        <dd>{formatPeso(row.approvedExcessMinor)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-500">Approved</dt>
                        <dd>{date(row.approvedAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-500">Expires</dt>
                        <dd>{date(row.expiresAt)}</dd>
                      </div>
                    </dl>
                    <p className="break-words text-sm">{row.reason}</p>
                    <details className="text-sm">
                      <summary className="cursor-pointer">Audit details</summary>
                      <dl className="mt-2 space-y-2 break-all">
                        <div>
                          <dt>Approval ID</dt>
                          <dd>{row.overrideId}</dd>
                        </div>
                        <div>
                          <dt>Approved by</dt>
                          <dd>{row.approvedBy}</dd>
                        </div>
                        {row.consumption && (
                          <>
                            <div>
                              <dt>Consumed</dt>
                              <dd>
                                {date(row.consumption.consumedAt)} · {formatPeso(row.consumption.excessMinor)}
                              </dd>
                            </div>
                            <div>
                              <dt>Exposure / limit at use</dt>
                              <dd>
                                {formatPeso(row.consumption.exposureMinor)} /{' '}
                                {formatPeso(row.consumption.creditLimitMinor)}
                              </dd>
                            </div>
                            <div>
                              <dt>Consumed by</dt>
                              <dd>{row.consumption.consumedBy}</dd>
                            </div>
                          </>
                        )}
                        {row.revokedAt && (
                          <>
                            <div>
                              <dt>Revoked</dt>
                              <dd>
                                {date(row.revokedAt)} · {row.revokeReason}
                              </dd>
                            </div>
                            <div>
                              <dt>Revoked by</dt>
                              <dd>{row.revokedBy}</dd>
                            </div>
                          </>
                        )}
                      </dl>
                    </details>
                  </article>
                ))
              ) : (
                <p className="p-4 text-sm text-ink-500">No approvals match these filters.</p>
              )}
            </div>
          </>
        )
      )}
    </section>
  )
}
