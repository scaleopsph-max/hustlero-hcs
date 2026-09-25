'use client'

import { createClient } from '@supabase/supabase-js'
import { ArrowLeft, NotebookPen, Save, Star } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  customerDetailSchema,
  customerNoteResponseSchema,
  customerUpdateResponseSchema,
  customersContextSchema,
  sessionContextResponseSchema,
  type CustomerDetail,
  type CustomersContext,
} from '@hcs/contracts'
import { Button, Chip, Glass, formatPeso } from '@hcs/ui'

const apiUrl = process.env.NEXT_PUBLIC_API_URL
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const control =
  'min-h-11 w-full rounded-control border border-ink-900/15 bg-white px-3 text-sm outline-none focus:border-ink-900'

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

export function CustomerDetailWorkspace({ customerId }: { customerId: string }) {
  const [auth] = useState(() => (supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null))
  const [token, setToken] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CustomerDetail | null>(null)
  const [context, setContext] = useState<CustomersContext>({ canManage: false, groups: [], customers: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [groupId, setGroupId] = useState('')
  const [customerType, setCustomerType] = useState<'standard' | 'reseller'>('standard')
  const [status, setStatus] = useState<'active' | 'inactive'>('active')
  const [emailConsent, setEmailConsent] = useState(false)
  const [smsConsent, setSmsConsent] = useState(false)
  const [note, setNote] = useState('')

  const applyDetail = (next: CustomerDetail) => {
    setDetail(next)
    setFullName(next.fullName)
    setEmail(next.email ?? '')
    setPhone(next.phone ?? '')
    setGroupId(next.customerGroupId)
    setCustomerType(next.customerType)
    setStatus(next.status)
    setEmailConsent(next.emailMarketingConsent)
    setSmsConsent(next.smsMarketingConsent)
  }
  const load = useCallback(
    async (nextToken: string, nextTenant: string) => {
      const [nextDetail, nextContext] = await Promise.all([
        call(`/v1/customers/${customerId}`, nextToken, nextTenant),
        call('/v1/customers', nextToken, nextTenant),
      ])
      applyDetail(customerDetailSchema.parse(nextDetail))
      setContext(customersContextSchema.parse(nextContext))
    },
    [customerId],
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
        if (!data.session) throw new Error('Sign in to view this customer.')
        const nextToken = data.session.access_token
        const session = sessionContextResponseSchema.parse(await call('/v1/me', nextToken, ''))
        const tenant = session.tenants.find((entry) => entry.isOwner) ?? session.tenants[0]
        if (!tenant) throw new Error('Create a business first.')
        setToken(nextToken)
        setTenantId(tenant.tenantId)
        await load(nextToken, tenant.tenantId)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load customer.')
      } finally {
        setLoading(false)
      }
    })
  }, [auth, load])

  async function update(event: FormEvent) {
    event.preventDefault()
    if (!token || !tenantId) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      customerUpdateResponseSchema.parse(
        await call(`/v1/customers/${customerId}`, token, tenantId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `customer-update-${crypto.randomUUID()}` },
          body: JSON.stringify({
            fullName,
            email: email.trim() || null,
            phone: phone.trim() || null,
            customerGroupId: groupId,
            customerType,
            emailMarketingConsent: emailConsent,
            smsMarketingConsent: smsConsent,
            status,
          }),
        }),
      )
      await load(token, tenantId)
      setMessage('Customer profile updated.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update customer.')
    } finally {
      setBusy(false)
    }
  }

  async function addNote(event: FormEvent) {
    event.preventDefault()
    if (!token || !tenantId) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      customerNoteResponseSchema.parse(
        await call(`/v1/customers/${customerId}/notes`, token, tenantId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `customer-note-${crypto.randomUUID()}` },
          body: JSON.stringify({ note }),
        }),
      )
      setNote('')
      await load(token, tenantId)
      setMessage('Customer note added.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add note.')
    } finally {
      setBusy(false)
    }
  }

  if (loading)
    return (
      <Glass variant="light" className="p-8 text-sm text-ink-500">
        Loading customer profile...
      </Glass>
    )
  if (!detail)
    return (
      <div className="border-l-2 border-red-600 bg-red-50 p-4 text-sm text-red-800">
        {error ?? 'Customer was not found.'}
      </div>
    )

  return (
    <div className="grid gap-4">
      {error ? <div className="border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {message ? (
        <div className="border-l-2 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/customers" className="inline-flex items-center gap-2 text-sm font-semibold">
          <ArrowLeft size={17} />
          Customers
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-500">{detail.customerNumber}</span>
          <Chip tone={detail.status === 'active' ? 'success' : 'neutral'}>{detail.status}</Chip>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="border border-ink-900/10 bg-white p-5">
          <div className="text-sm text-ink-500">Net spend</div>
          <div className="mt-1 font-display text-3xl font-bold">{formatPeso(detail.totalSpendCentavos)}</div>
        </div>
        <div className="border border-ink-900/10 bg-white p-5">
          <div className="text-sm text-ink-500">Visits</div>
          <div className="mt-1 font-display text-3xl font-bold">{detail.visitCount}</div>
        </div>
        <div className="border border-ink-900/10 bg-white p-5">
          <div className="text-sm text-ink-500">Origin</div>
          <div className="mt-1 font-display text-3xl font-bold capitalize">{detail.origin}</div>
        </div>
        <div className="border border-ink-900/10 bg-white p-5">
          <div className="flex items-center justify-between gap-2 text-sm text-ink-500">
            Loyalty balance
            <Chip tone={detail.loyalty.enabled ? 'success' : 'neutral'}>
              {detail.loyalty.enabled ? 'Active' : 'Off'}
            </Chip>
          </div>
          <div className="mt-1 font-display text-3xl font-bold">{detail.loyalty.balancePoints} pts</div>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <Glass variant="data" className="p-5">
          <h2 className="mb-4 font-display text-xl font-bold">Profile</h2>
          <form className="grid gap-3" onSubmit={update}>
            <label className="grid gap-1 text-sm font-medium">
              Full name
              <input
                className={control}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                required
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Email
              <input
                className={control}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Phone
              <input className={control} value={phone} onChange={(event) => setPhone(event.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm font-medium">
                Group
                <select className={control} value={groupId} onChange={(event) => setGroupId(event.target.value)}>
                  {context.groups
                    .filter((group) => group.isActive)
                    .map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Type
                <select
                  className={control}
                  value={customerType}
                  onChange={(event) => setCustomerType(event.target.value as typeof customerType)}
                >
                  <option value="standard">Standard</option>
                  <option value="reseller">Reseller</option>
                </select>
              </label>
            </div>
            <label className="grid gap-1 text-sm font-medium">
              Status
              <select
                className={control}
                value={status}
                onChange={(event) => setStatus(event.target.value as typeof status)}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={emailConsent}
                onChange={(event) => setEmailConsent(event.target.checked)}
              />
              Email marketing consent
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={smsConsent} onChange={(event) => setSmsConsent(event.target.checked)} />
              SMS marketing consent
            </label>
            <Button type="submit" variant="primary" disabled={busy || !detail.canManage}>
              <Save size={16} className="mr-2" />
              Save profile
            </Button>
          </form>
        </Glass>
        <div className="grid gap-4">
          <Glass variant="light" className="overflow-hidden">
            <div className="border-b border-ink-900/10 p-5">
              <h2 className="font-display text-xl font-bold">Purchase history</h2>
            </div>
            {detail.purchases.length ? (
              detail.purchases.map((purchase) => (
                <Link
                  key={purchase.saleId}
                  href={`/sales/${purchase.saleId}`}
                  className="grid grid-cols-[1fr_auto] gap-3 border-b border-ink-900/10 px-5 py-4 text-sm last:border-0 hover:bg-ink-900/[0.03]"
                >
                  <div>
                    <strong>{purchase.receiptNumber}</strong>
                    <div className="mt-1 text-xs text-ink-500">
                      {purchase.locationName} · {new Date(purchase.completedAt).toLocaleString('en-PH')}
                    </div>
                  </div>
                  <div className="text-right">
                    <strong>{formatPeso(purchase.totalCentavos - purchase.refundedCentavos)}</strong>
                    {purchase.refundedCentavos ? (
                      <div className="text-xs text-ink-500">Refunded {formatPeso(purchase.refundedCentavos)}</div>
                    ) : null}
                  </div>
                </Link>
              ))
            ) : (
              <p className="p-5 text-sm text-ink-500">No linked purchases yet.</p>
            )}
          </Glass>
          <Glass variant="light" className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-ink-900/10 p-5">
              <div className="flex items-center gap-3">
                <Star size={20} />
                <h2 className="font-display text-xl font-bold">Loyalty activity</h2>
              </div>
              <span className="text-xs text-ink-500">
                Earned {detail.loyalty.lifetimeEarnedPoints} · Reversed {detail.loyalty.lifetimeReversedPoints}
              </span>
            </div>
            {detail.loyalty.transactions.length ? (
              detail.loyalty.transactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="grid grid-cols-[1fr_auto] gap-3 border-b border-ink-900/10 px-5 py-4 text-sm last:border-0"
                >
                  <div>
                    <strong>{transaction.type === 'sale_earn' ? 'POS sale earned' : 'Refund reversal'}</strong>
                    <div className="mt-1 text-xs text-ink-500">
                      {transaction.receiptNumber} · {new Date(transaction.occurredAt).toLocaleString('en-PH')}
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
              <p className="p-5 text-sm text-ink-500">No loyalty activity yet.</p>
            )}
          </Glass>
          <Glass variant="light" className="p-5">
            <div className="mb-4 flex items-center gap-3">
              <NotebookPen size={20} />
              <h2 className="font-display text-xl font-bold">Notes</h2>
            </div>
            <form className="mb-5 flex gap-2" onSubmit={addNote}>
              <input
                className={control}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Add an operational note"
              />
              <Button type="submit" variant="secondary" disabled={busy || note.trim().length < 2}>
                Add
              </Button>
            </form>
            {detail.notes.length ? (
              detail.notes.map((entry) => (
                <div key={entry.id} className="border-t border-ink-900/10 py-3 text-sm">
                  <p>{entry.note}</p>
                  <p className="mt-1 text-xs text-ink-500">
                    {entry.actorName} · {new Date(entry.createdAt).toLocaleString('en-PH')}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-ink-500">No notes yet.</p>
            )}
          </Glass>
        </div>
      </div>
    </div>
  )
}
