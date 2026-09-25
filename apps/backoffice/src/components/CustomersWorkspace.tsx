'use client'

import { createClient } from '@supabase/supabase-js'
import { Plus, Search, Users } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  customerCreateResponseSchema,
  customersContextSchema,
  sessionContextResponseSchema,
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

export function CustomersWorkspace() {
  const router = useRouter()
  const [auth] = useState(() => (supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null))
  const [token, setToken] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [data, setData] = useState<CustomersContext>({ canManage: false, groups: [], customers: [] })
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [groupId, setGroupId] = useState('')
  const [customerType, setCustomerType] = useState<'standard' | 'reseller'>('standard')
  const [emailConsent, setEmailConsent] = useState(false)
  const [smsConsent, setSmsConsent] = useState(false)

  const load = useCallback(async (nextToken: string, nextTenant: string, search = '') => {
    const next = customersContextSchema.parse(
      await call(`/v1/customers${search ? `?q=${encodeURIComponent(search)}` : ''}`, nextToken, nextTenant),
    )
    setData(next)
    setGroupId((value) => value || next.groups.find((group) => group.isActive)?.id || '')
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
        if (!sessionData.session) throw new Error('Sign in to manage customers.')
        const nextToken = sessionData.session.access_token
        const session = sessionContextResponseSchema.parse(await call('/v1/me', nextToken, ''))
        const tenant = session.tenants.find((entry) => entry.isOwner) ?? session.tenants[0]
        if (!tenant) throw new Error('Create a business first.')
        setToken(nextToken)
        setTenantId(tenant.tenantId)
        await load(nextToken, tenant.tenantId)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load customers.')
      } finally {
        setLoading(false)
      }
    })
  }, [auth, load])

  async function search(event: FormEvent) {
    event.preventDefault()
    if (!token || !tenantId) return
    setLoading(true)
    setError(null)
    try {
      await load(token, tenantId, query)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not search customers.')
    } finally {
      setLoading(false)
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!token || !tenantId) return
    setBusy(true)
    setError(null)
    try {
      const created = customerCreateResponseSchema.parse(
        await call('/v1/customers', token, tenantId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `customer-${crypto.randomUUID()}` },
          body: JSON.stringify({
            fullName,
            email: email.trim() || null,
            phone: phone.trim() || null,
            customerGroupId: groupId || null,
            customerType,
            emailMarketingConsent: emailConsent,
            smsMarketingConsent: smsConsent,
          }),
        }),
      )
      router.push(`/customers/${created.customerId}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create customer.')
    } finally {
      setBusy(false)
    }
  }

  if (loading && !token)
    return (
      <Glass variant="light" className="p-8 text-sm text-ink-500">
        Loading customers...
      </Glass>
    )

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_380px]">
      {error ? (
        <div className="border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-700 xl:col-span-2">{error}</div>
      ) : null}
      <Glass variant="light" className="overflow-hidden">
        <form className="flex gap-2 border-b border-ink-900/10 p-4" onSubmit={search}>
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-3 text-ink-400" />
            <input
              className={`${control} pl-10`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, customer number, email, or phone"
            />
          </div>
          <Button type="submit" variant="secondary" disabled={loading}>
            Search
          </Button>
        </form>
        <div className="grid grid-cols-[1.25fr_1fr_0.7fr_0.7fr] gap-3 border-b border-ink-900/10 px-5 py-3 text-xs font-semibold uppercase text-ink-500">
          <span>Customer</span>
          <span>Contact</span>
          <span>Visits</span>
          <span className="text-right">Net spend</span>
        </div>
        {data.customers.length ? (
          data.customers.map((customer) => (
            <Link
              key={customer.id}
              href={`/customers/${customer.id}`}
              className="grid grid-cols-[1.25fr_1fr_0.7fr_0.7fr] items-center gap-3 border-b border-ink-900/10 px-5 py-4 text-sm transition-colors last:border-0 hover:bg-ink-900/[0.03]"
            >
              <div>
                <div className="font-semibold">{customer.fullName}</div>
                <div className="mt-1 flex gap-2">
                  <span className="text-xs text-ink-500">{customer.customerNumber}</span>
                  <Chip tone={customer.status === 'active' ? 'success' : 'neutral'}>{customer.status}</Chip>
                </div>
              </div>
              <div className="min-w-0">
                <div className="truncate">{customer.email ?? customer.phone}</div>
                <div className="text-xs text-ink-500">{customer.groupName ?? customer.customerType}</div>
              </div>
              <span>{customer.visitCount}</span>
              <strong className="text-right">{formatPeso(customer.totalSpendCentavos)}</strong>
            </Link>
          ))
        ) : (
          <div className="grid place-items-center gap-2 px-5 py-16 text-center">
            <Users size={34} className="text-ink-400" />
            <strong>No customers yet</strong>
            <span className="text-sm text-ink-500">Create the first profile or add one from POS.</span>
          </div>
        )}
      </Glass>
      <Glass variant="data" className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <Plus size={21} />
          <h2 className="font-display text-xl font-bold">New customer</h2>
        </div>
        <form className="grid gap-3" onSubmit={create}>
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
            <input className={control} type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Phone
            <input
              className={control}
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Group
            <select className={control} value={groupId} onChange={(event) => setGroupId(event.target.value)}>
              {data.groups
                .filter((group) => group.isActive)
                .map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Customer type
            <select
              className={control}
              value={customerType}
              onChange={(event) => setCustomerType(event.target.value as typeof customerType)}
            >
              <option value="standard">Standard</option>
              <option value="reseller">Reseller</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={emailConsent} onChange={(event) => setEmailConsent(event.target.checked)} />
            Email marketing consent
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={smsConsent} onChange={(event) => setSmsConsent(event.target.checked)} />
            SMS marketing consent
          </label>
          <p className="text-xs text-ink-500">
            At least one contact method is required. Marketing remains off unless explicitly checked.
          </p>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !fullName.trim() || (!email.trim() && !phone.trim())}
          >
            {busy ? 'Creating...' : 'Create customer'}
          </Button>
        </form>
      </Glass>
    </div>
  )
}
