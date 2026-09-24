'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Check, Loader2, ShieldCheck, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  approvalCenterSchema,
  approvalDecisionResponseSchema,
  approvalPolicyUpdateResponseSchema,
  sessionContextResponseSchema,
  type ApprovalCenter as ApprovalCenterData,
} from '@hcs/contracts'
import { Button, Chip, Glass, cn } from '@hcs/ui'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const apiUrl = process.env.NEXT_PUBLIC_API_URL

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

function formatQuantity(value: number): string {
  const sign = value < 0 ? '-' : ''
  const absolute = Math.abs(value)
  const fraction = String(absolute % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '')
  return `${sign}${Math.floor(absolute / 1000).toLocaleString('en-PH')}${fraction ? `.${fraction}` : ''}`
}

function parseThreshold(value: string): number {
  const match = /^(\d+)(?:\.(\d{0,3}))?$/.exec(value.trim())
  if (!match) throw new Error('Use a threshold with up to three decimal places.')
  return Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'))
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(
    new Date(value),
  )
}

type Status = 'pending' | 'approved' | 'rejected'

export function ApprovalCenter() {
  const [auth] = useState(client)
  const [token, setToken] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [data, setData] = useState<ApprovalCenterData | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [tab, setTab] = useState<Status>('pending')
  const [threshold, setThreshold] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async (accessToken: string, selectedTenantId: string, authClient: SupabaseClient) => {
    const next = approvalCenterSchema.parse(
      await apiRequest('/v1/approvals', accessToken, selectedTenantId, authClient),
    )
    setData(next)
    setEnabled(next.inventoryAdjustmentThresholdMilli !== null)
    setThreshold(
      next.inventoryAdjustmentThresholdMilli === null ? '' : formatQuantity(next.inventoryAdjustmentThresholdMilli),
    )
  }, [])

  useEffect(() => {
    if (!auth) {
      setLoading(false)
      return
    }
    void auth.auth.getSession().then(async ({ data: sessionData, error: sessionError }) => {
      try {
        if (sessionError) throw sessionError
        if (!sessionData.session) throw new Error('Sign in to view approvals.')
        const accessToken = sessionData.session.access_token
        const session = sessionContextResponseSchema.parse(await apiRequest('/v1/me', accessToken, '', auth))
        const tenant = session.tenants.find((item) => item.isOwner) ?? session.tenants[0]
        if (!tenant) throw new Error('Create a business before viewing approvals.')
        setIsOwner(tenant.isOwner)
        setToken(accessToken)
        setTenantId(tenant.tenantId)
        await load(accessToken, tenant.tenantId, auth)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load approvals.')
      } finally {
        setLoading(false)
      }
    })
  }, [auth, load])

  const rows = useMemo(() => (data?.requests ?? []).filter((request) => request.status === tab), [data, tab])

  async function savePolicy() {
    if (!auth || !token || !tenantId) return
    setBusy('policy')
    setError(null)
    setNotice(null)
    try {
      const request = { inventoryAdjustmentThresholdMilli: enabled ? parseThreshold(threshold) : null }
      approvalPolicyUpdateResponseSchema.parse(
        await apiRequest('/v1/approvals/policy', token, tenantId, auth, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify(request),
        }),
      )
      await load(token, tenantId, auth)
      setNotice(enabled ? 'Adjustment approval threshold updated.' : 'Adjustment approvals disabled.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the policy.')
    } finally {
      setBusy(null)
    }
  }

  async function decide(id: string, decision: 'approved' | 'rejected') {
    if (!auth || !token || !tenantId) return
    setBusy(id)
    setError(null)
    setNotice(null)
    try {
      approvalDecisionResponseSchema.parse(
        await apiRequest(`/v1/approvals/${id}/decision`, token, tenantId, auth, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({ decision, note: null }),
        }),
      )
      await load(token, tenantId, auth)
      setNotice(`Request ${decision}.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not decide this request.')
    } finally {
      setBusy(null)
    }
  }

  if (loading)
    return (
      <div className="flex min-h-72 items-center justify-center text-sm text-ink-500">
        <Loader2 size={20} className="mr-2 animate-spin" /> Loading approvals...
      </div>
    )

  return (
    <div className="flex flex-col gap-4">
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
      <section className="grid gap-4 border-y border-ink-900/10 bg-white/40 px-1 py-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} />
            <h2 className="font-display text-lg font-bold">Inventory adjustment policy</h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-ink-600">
            Require approval when the absolute adjustment quantity is greater than the configured threshold. Stock
            changes only after approval.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex items-center gap-2 pb-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!(data?.canManage || isOwner) || busy === 'policy'}
              onChange={(event) => setEnabled(event.target.checked)}
            />{' '}
            Enabled
          </label>
          <label className="min-w-36 flex-1 text-xs font-semibold">
            Quantity threshold
            <input
              aria-label="Adjustment approval threshold"
              value={threshold}
              disabled={!enabled || !(data?.canManage || isOwner) || busy === 'policy'}
              onChange={(event) => setThreshold(event.target.value)}
              placeholder="10"
              inputMode="decimal"
              className="mt-1 h-10 w-full rounded-control border border-ink-900/15 bg-white px-3 text-sm"
            />
          </label>
          <Button
            size="sm"
            disabled={!(data?.canManage || isOwner) || busy === 'policy' || (enabled && !threshold.trim())}
            onClick={() => void savePolicy()}
          >
            {busy === 'policy' ? <Loader2 size={16} className="mr-2 animate-spin" /> : null}Save policy
          </Button>
        </div>
      </section>
      <div className="inline-flex w-fit rounded-control border border-ink-900/15 bg-white/70 p-1" role="tablist">
        {(['pending', 'approved', 'rejected'] as const).map((status) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={tab === status}
            onClick={() => setTab(status)}
            className={cn(
              'h-9 px-4 text-sm font-semibold capitalize',
              tab === status ? 'rounded-control bg-ink-900 text-white' : 'text-ink-700',
            )}
          >
            {status} ({data?.requests.filter((item) => item.status === status).length ?? 0})
          </button>
        ))}
      </div>
      <Glass variant="data" className="overflow-x-auto rounded-panel p-4">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead className="text-xs uppercase text-ink-500">
            <tr>
              <th className="border-b border-ink-900/10 py-3">Item</th>
              <th className="border-b border-ink-900/10 py-3">Location</th>
              <th className="border-b border-ink-900/10 py-3 text-right">Change</th>
              <th className="border-b border-ink-900/10 py-3">Reason</th>
              <th className="border-b border-ink-900/10 py-3">Requested</th>
              <th className="border-b border-ink-900/10 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((request) => (
              <tr key={request.id} className="border-b border-ink-900/10">
                <td className="py-4 pr-4">
                  <span className="block font-semibold">{request.productName}</span>
                  <span className="text-xs text-ink-500">
                    {request.variantName}, {request.sku}
                  </span>
                </td>
                <td className="py-4 pr-4">{request.locationName}</td>
                <td
                  className={cn(
                    'py-4 pr-4 text-right font-bold',
                    request.quantityMilli < 0 ? 'text-red-700' : 'text-emerald-700',
                  )}
                >
                  {request.quantityMilli > 0 ? '+' : ''}
                  {formatQuantity(request.quantityMilli)}
                </td>
                <td className="max-w-64 py-4 pr-4">{request.reason}</td>
                <td className="py-4 pr-4">
                  <span className="block">{request.requestedByLabel}</span>
                  <span className="text-xs text-ink-500">{formatDate(request.requestedAt)}</span>
                </td>
                <td className="py-4 text-right">
                  {request.status === 'pending' && (data?.canManage || isOwner) ? (
                    <span className="inline-flex gap-2">
                      <Button
                        size="sm"
                        variant="confirm"
                        disabled={busy === request.id}
                        onClick={() => void decide(request.id, 'approved')}
                      >
                        <Check size={16} className="mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy === request.id}
                        onClick={() => void decide(request.id, 'rejected')}
                      >
                        <X size={16} className="mr-1" />
                        Reject
                      </Button>
                    </span>
                  ) : (
                    <Chip surface="light" tone={request.status === 'approved' ? 'success' : 'critical'}>
                      {request.status}
                    </Chip>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <div className="py-14 text-center text-sm text-ink-500">No {tab} approval requests.</div>
        ) : null}
      </Glass>
    </div>
  )
}
