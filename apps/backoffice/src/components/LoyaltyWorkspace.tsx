'use client'

import { createClient } from '@supabase/supabase-js'
import { Save, Star } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  loyaltyContextSchema,
  loyaltyPolicyUpdateResponseSchema,
  sessionContextResponseSchema,
  type LoyaltyContext,
} from '@hcs/contracts'
import { Button, Chip, Glass, formatPeso, parsePeso } from '@hcs/ui'

const apiUrl = process.env.NEXT_PUBLIC_API_URL
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

async function call(path: string, token: string, tenantId: string, options: RequestInit = {}) {
  if (!apiUrl) throw new Error('Back Office API URL is not configured.')
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenantId, ...options.headers },
  })
  const data: unknown = await response.json()
  if (!response.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? 'Request failed.')
  return data
}

export function LoyaltyWorkspace() {
  const [auth] = useState(() => (supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null))
  const [token, setToken] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [data, setData] = useState<LoyaltyContext | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [spend, setSpend] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async (nextToken: string, nextTenant: string) => {
    const next = loyaltyContextSchema.parse(await call('/v1/loyalty', nextToken, nextTenant))
    setData(next)
    setEnabled(next.policy.enabled)
    setSpend(next.policy.spendPerPointCentavos ? (next.policy.spendPerPointCentavos / 100).toFixed(2) : '')
  }, [])

  useEffect(() => {
    if (!auth) {
      setError('Back Office authentication is not configured.')
      setLoading(false)
      return
    }
    void auth.auth.getSession().then(async ({ data: sessionData, error: sessionError }) => {
      try {
        if (sessionError) throw sessionError
        if (!sessionData.session) throw new Error('Sign in to manage loyalty.')
        const nextToken = sessionData.session.access_token
        const session = sessionContextResponseSchema.parse(await call('/v1/me', nextToken, ''))
        const tenant = session.tenants.find((entry) => entry.isOwner) ?? session.tenants[0]
        if (!tenant) throw new Error('Create a business first.')
        setToken(nextToken)
        setTenantId(tenant.tenantId)
        await load(nextToken, tenant.tenantId)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load loyalty.')
      } finally {
        setLoading(false)
      }
    })
  }, [auth, load])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!token || !tenantId) return
    const spendPerPointCentavos = spend.trim() ? parsePeso(spend) : null
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      loyaltyPolicyUpdateResponseSchema.parse(
        await call('/v1/loyalty/policy', token, tenantId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `loyalty-policy-${crypto.randomUUID()}` },
          body: JSON.stringify({ enabled, spendPerPointCentavos }),
        }),
      )
      await load(token, tenantId)
      setMessage(enabled ? 'Loyalty earning is active.' : 'Loyalty earning is paused.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update loyalty.')
    } finally {
      setBusy(false)
    }
  }

  if (loading)
    return (
      <Glass variant="light" className="p-8 text-sm text-ink-500">
        Loading loyalty...
      </Glass>
    )
  if (!data) return <div className="border-l-2 border-red-600 bg-red-50 p-4 text-sm text-red-800">{error}</div>

  return (
    <div className="grid gap-4">
      {error ? <div className="border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {message ? (
        <div className="border-l-2 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Members', data.summary.memberCount],
          ['Outstanding points', data.summary.outstandingPoints],
          ['Lifetime earned', data.summary.lifetimeEarnedPoints],
          ['Refund reversals', data.summary.lifetimeReversedPoints],
        ].map(([label, value]) => (
          <div key={label} className="border border-ink-900/10 bg-white p-5">
            <div className="text-sm text-ink-500">{label}</div>
            <div className="mt-1 font-display text-3xl font-bold">{value}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Glass variant="data" className="p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold">Earning policy</h2>
              <p className="mt-1 text-sm text-ink-500">Applies only to customer-linked POS sales.</p>
            </div>
            <Chip tone={data.policy.enabled ? 'success' : 'neutral'}>{data.policy.enabled ? 'Active' : 'Off'}</Chip>
          </div>
          <form className="grid gap-4" onSubmit={save}>
            <label className="flex min-h-12 items-center justify-between gap-4 border-y border-ink-900/10 py-3 text-sm font-medium">
              Enable loyalty earning
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Spend required for 1 point
              <input
                value={spend}
                onChange={(event) => setSpend(event.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                placeholder="100.00"
                className="min-h-11 border border-ink-900/15 bg-white px-3 outline-none focus:border-ink-900"
              />
            </label>
            <p className="text-xs text-ink-500">
              Example:{' '}
              {spend && parsePeso(spend) > 0 ? `${formatPeso(parsePeso(spend))} = 1 point` : 'set the amount first'}.
              Refunds automatically reverse points using the rate captured on the original sale.
            </p>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !data.canManage || (enabled && parsePeso(spend) <= 0)}
            >
              <Save size={16} className="mr-2" />
              {busy ? 'Saving...' : 'Save policy'}
            </Button>
          </form>
        </Glass>
        <Glass variant="light" className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-ink-900/10 p-5">
            <Star size={20} />
            <h2 className="font-display text-xl font-bold">Recent point activity</h2>
          </div>
          {data.recentTransactions.length ? (
            data.recentTransactions.map((transaction) => (
              <div
                key={transaction.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-ink-900/10 px-5 py-4 text-sm last:border-0"
              >
                <div className="min-w-0">
                  <Link href={`/customers/${transaction.customerId}`} className="font-semibold hover:underline">
                    {transaction.customerName}
                  </Link>
                  <div className="mt-1 text-xs text-ink-500">
                    {transaction.customerNumber} · {transaction.receiptNumber} ·{' '}
                    {new Date(transaction.occurredAt).toLocaleString('en-PH')}
                  </div>
                </div>
                <div className="text-right">
                  <strong className={transaction.pointsDelta > 0 ? 'text-emerald-700' : 'text-red-700'}>
                    {transaction.pointsDelta > 0 ? '+' : ''}
                    {transaction.pointsDelta} pts
                  </strong>
                  <div className="text-xs text-ink-500">Balance {transaction.balanceAfterPoints}</div>
                </div>
              </div>
            ))
          ) : (
            <p className="p-5 text-sm text-ink-500">No point activity yet.</p>
          )}
        </Glass>
      </div>
    </div>
  )
}
