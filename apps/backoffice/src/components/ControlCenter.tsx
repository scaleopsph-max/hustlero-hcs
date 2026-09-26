'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { AlertTriangle, Check, Loader2, RefreshCw, Search, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  alertCenterSchema,
  alertStatusUpdateResponseSchema,
  auditActivityContextSchema,
  sessionContextResponseSchema,
  type AlertCenter,
  type AlertStatusUpdateRequest,
  type AuditActivityContext,
} from '@hcs/contracts'
import { Button, Chip, Glass, cn, type ChipTone } from '@hcs/ui'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const apiUrl = process.env.NEXT_PUBLIC_API_URL
const control = 'min-h-11 w-full border border-ink-900/15 bg-white px-3 text-sm font-medium text-ink-900'

function client(): SupabaseClient | null {
  return supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null
}

async function apiRequest(path: string, token: string, tenantId: string, auth: SupabaseClient, options?: RequestInit) {
  if (!apiUrl) throw new Error('Back Office API URL is not configured.')
  const request = (accessToken: string) =>
    fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
      ...options,
      cache: 'no-store',
      headers: { Authorization: `Bearer ${accessToken}`, 'X-Tenant-Id': tenantId, ...options?.headers },
    })
  let response = await request(token)
  if (response.status === 401) {
    const refreshed = await auth.auth.refreshSession()
    if (!refreshed.error && refreshed.data.session) response = await request(refreshed.data.session.access_token)
  }
  const data: unknown = await response.json()
  if (!response.ok)
    throw new Error((data as { error?: { message?: string } }).error?.message ?? 'The request could not be completed.')
  return data
}

function localDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(value))
}

function label(value: string) {
  return value.replaceAll('_', ' ').replaceAll('.', ' / ')
}

function useBusinessSession(purpose: string) {
  const [auth] = useState(client)
  const [token, setToken] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!auth) {
      setError('Back Office authentication is not configured.')
      setLoading(false)
      return
    }
    void auth.auth.getSession().then(async ({ data, error: sessionError }) => {
      try {
        if (sessionError) throw sessionError
        if (!data.session) throw new Error(`Sign in to view ${purpose}.`)
        const accessToken = data.session.access_token
        const session = sessionContextResponseSchema.parse(await apiRequest('/v1/me', accessToken, '', auth))
        const tenant = session.tenants.find((entry) => entry.isOwner) ?? session.tenants[0]
        if (!tenant) throw new Error('Create a business first.')
        setToken(accessToken)
        setTenantId(tenant.tenantId)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : `Could not load ${purpose}.`)
      } finally {
        setLoading(false)
      }
    })
  }, [auth, purpose])

  return { auth, token, tenantId, loading, setLoading, error, setError }
}

const severityTone: Record<AlertCenter['alerts'][number]['severity'], ChipTone> = {
  info: 'info',
  attention: 'attention',
  warning: 'warning',
  critical: 'critical',
}

type AlertStatus = AlertCenter['alerts'][number]['status']

export function AlertsWorkspace() {
  const session = useBusinessSession('alerts')
  const [data, setData] = useState<AlertCenter | null>(null)
  const [status, setStatus] = useState<AlertStatus>('open')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session.auth || !session.token || !session.tenantId) return
    session.setLoading(true)
    session.setError(null)
    try {
      setData(alertCenterSchema.parse(await apiRequest('/v1/alerts', session.token, session.tenantId, session.auth)))
    } catch (cause) {
      session.setError(cause instanceof Error ? cause.message : 'Could not load alerts.')
    } finally {
      session.setLoading(false)
    }
  }, [session.auth, session.setError, session.setLoading, session.tenantId, session.token])

  useEffect(() => {
    if (session.auth && session.token && session.tenantId) void load()
  }, [load, session.auth, session.tenantId, session.token])

  async function update(alertId: string, nextStatus: AlertStatusUpdateRequest['status']) {
    if (!session.auth || !session.token || !session.tenantId) return
    setBusy(alertId)
    setNotice(null)
    session.setError(null)
    try {
      alertStatusUpdateResponseSchema.parse(
        await apiRequest(`/v1/alerts/${alertId}`, session.token, session.tenantId, session.auth, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus, note: null }),
        }),
      )
      await load()
      setNotice(`Alert marked ${nextStatus}.`)
    } catch (cause) {
      session.setError(cause instanceof Error ? cause.message : 'Could not update the alert.')
    } finally {
      setBusy(null)
    }
  }

  const alerts = useMemo(() => data?.alerts.filter((alert) => alert.status === status) ?? [], [data, status])
  const statuses: AlertStatus[] = ['open', 'acknowledged', 'resolved', 'dismissed']

  if (session.loading && !data) return <LoadingState label="Loading alerts..." />

  return (
    <div className="grid gap-4">
      <Feedback error={session.error} notice={notice} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex max-w-full overflow-x-auto border border-ink-900/15 bg-white/70 p-1" role="tablist">
          {statuses.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={status === item}
              onClick={() => setStatus(item)}
              className={cn(
                'h-9 whitespace-nowrap px-4 text-sm font-semibold capitalize',
                status === item ? 'bg-ink-900 text-white' : 'text-ink-700',
              )}
            >
              {item} ({data?.counts[item] ?? 0})
            </button>
          ))}
        </div>
        <Button size="sm" disabled={session.loading} onClick={() => void load()}>
          <RefreshCw size={16} className={cn('mr-2', session.loading && 'animate-spin')} /> Refresh
        </Button>
      </div>
      {alerts.length === 0 ? (
        <Glass variant="data" className="grid min-h-64 place-items-center p-8 text-center">
          <div>
            <Check className="mx-auto text-emerald-700" size={28} />
            <h2 className="mt-3 font-display text-xl font-bold">No {status} alerts</h2>
            <p className="mt-1 text-sm text-ink-500">This queue is clear for the selected status.</p>
          </div>
        </Glass>
      ) : (
        <div className="grid gap-3">
          {alerts.map((alert) => (
            <article key={alert.id} className="border border-ink-900/10 bg-white/75 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <AlertTriangle className="mt-0.5 flex-none text-ink-600" size={20} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-lg font-bold">{alert.title}</h2>
                      <Chip surface="light" tone={severityTone[alert.severity]}>
                        {alert.severity}
                      </Chip>
                      <Chip surface="light">{label(alert.category)}</Chip>
                    </div>
                    <p className="mt-1 text-sm text-ink-700">{alert.message}</p>
                    <p className="mt-2 text-xs text-ink-500">
                      {alert.locationName ?? 'All locations'} · Last detected {formatDate(alert.lastDetectedAt)}
                    </p>
                  </div>
                </div>
                {data?.canManage && (alert.status === 'open' || alert.status === 'acknowledged') ? (
                  <div className="flex flex-wrap gap-2">
                    {alert.status === 'open' ? (
                      <Button
                        size="sm"
                        disabled={busy === alert.id}
                        onClick={() => void update(alert.id, 'acknowledged')}
                      >
                        Acknowledge
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="confirm"
                      disabled={busy === alert.id}
                      onClick={() => void update(alert.id, 'resolved')}
                    >
                      <Check size={16} className="mr-2" /> Resolve
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === alert.id}
                      onClick={() => void update(alert.id, 'dismissed')}
                    >
                      <X size={16} className="mr-2" /> Dismiss
                    </Button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

export function AuditWorkspace() {
  const session = useBusinessSession('audit activity')
  const [data, setData] = useState<AuditActivityContext | null>(null)
  const [from, setFrom] = useState(localDate(-29))
  const [to, setTo] = useState(localDate())
  const [locationId, setLocationId] = useState('')
  const [actorType, setActorType] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    if (!session.auth || !session.token || !session.tenantId) return
    session.setLoading(true)
    session.setError(null)
    try {
      const query = new URLSearchParams({ from, to, search, limit: '100', offset: '0' })
      if (locationId) query.set('locationId', locationId)
      if (actorType) query.set('actorType', actorType)
      setData(
        auditActivityContextSchema.parse(
          await apiRequest(`/v1/audit-activity?${query}`, session.token, session.tenantId, session.auth),
        ),
      )
    } catch (cause) {
      session.setError(cause instanceof Error ? cause.message : 'Could not load audit activity.')
    } finally {
      session.setLoading(false)
    }
  }, [
    actorType,
    from,
    locationId,
    search,
    session.auth,
    session.setError,
    session.setLoading,
    session.tenantId,
    session.token,
    to,
  ])

  useEffect(() => {
    if (session.auth && session.token && session.tenantId) void load()
    // Initial session load only; Apply handles subsequent filter changes.
  }, [session.auth, session.tenantId, session.token])

  if (session.loading && !data) return <LoadingState label="Loading audit activity..." />

  return (
    <div className="grid gap-4">
      <Feedback error={session.error} />
      <Glass variant="light" className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.2fr_1fr_1.6fr_auto]">
        <Filter label="From">
          <input
            type="date"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
            className={control}
          />
        </Filter>
        <Filter label="To">
          <input
            type="date"
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
            className={control}
          />
        </Filter>
        <Filter label="Location">
          <select value={locationId} onChange={(event) => setLocationId(event.target.value)} className={control}>
            <option value="">All locations</option>
            {data?.locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </Filter>
        <Filter label="Actor">
          <select value={actorType} onChange={(event) => setActorType(event.target.value)} className={control}>
            <option value="">All actors</option>
            <option value="tenant_user">Back Office user</option>
            <option value="pos_employee">POS employee</option>
            <option value="system">System</option>
          </select>
        </Filter>
        <Filter label="Search">
          <span className="relative">
            <Search size={16} className="absolute left-3 top-3.5 text-ink-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Action, record or reason"
              className={cn(control, 'pl-9')}
            />
          </span>
        </Filter>
        <Button
          size="sm"
          variant="primary"
          className="self-end"
          disabled={session.loading || !from || !to}
          onClick={() => void load()}
        >
          {session.loading ? <Loader2 size={16} className="mr-2 animate-spin" /> : null}Apply
        </Button>
      </Glass>
      <Glass variant="data" className="overflow-x-auto p-4">
        <div className="mb-3 flex items-center justify-between text-sm">
          <span className="font-semibold">Activity log</span>
          <span className="text-ink-500">{data?.total ?? 0} records</span>
        </div>
        <table className="w-full min-w-[960px] border-collapse text-left text-sm">
          <thead className="text-xs uppercase text-ink-500">
            <tr>
              <th className="border-b border-ink-900/10 py-3">When</th>
              <th className="border-b border-ink-900/10 py-3">Actor</th>
              <th className="border-b border-ink-900/10 py-3">Action</th>
              <th className="border-b border-ink-900/10 py-3">Record</th>
              <th className="border-b border-ink-900/10 py-3">Location</th>
              <th className="border-b border-ink-900/10 py-3">Reason</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((item) => (
              <tr key={item.id} className="border-b border-ink-900/10 align-top">
                <td className="whitespace-nowrap py-4 pr-5 text-xs text-ink-600">{formatDate(item.occurredAt)}</td>
                <td className="py-4 pr-5">
                  <span className="block font-semibold">{item.actorLabel}</span>
                  <span className="text-xs capitalize text-ink-500">{label(item.actorType)}</span>
                </td>
                <td className="py-4 pr-5 font-medium">{label(item.action)}</td>
                <td className="py-4 pr-5">
                  <span className="block capitalize">{label(item.entityType)}</span>
                  {item.entityId ? <span className="text-xs text-ink-500">{item.entityId.slice(0, 8)}</span> : null}
                </td>
                <td className="py-4 pr-5">{item.locationName ?? 'Business-wide'}</td>
                <td className="max-w-72 py-4 text-ink-600">{item.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.items.length === 0 ? (
          <div className="grid min-h-48 place-items-center text-sm text-ink-500">
            No activity matches these filters.
          </div>
        ) : null}
      </Glass>
    </div>
  )
}

function LoadingState({ label: text }: { label: string }) {
  return (
    <div className="flex min-h-72 items-center justify-center text-sm text-ink-500">
      <Loader2 size={20} className="mr-2 animate-spin" />
      {text}
    </div>
  )
}

function Feedback({ error, notice }: { error?: string | null; notice?: string | null }) {
  return (
    <>
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
    </>
  )
}

function Filter({ label: text, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-ink-500">
      {text}
      {children}
    </label>
  )
}
