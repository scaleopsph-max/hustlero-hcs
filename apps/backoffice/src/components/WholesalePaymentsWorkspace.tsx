'use client'

import { selectActiveTenant } from '@/lib/active-tenant'
import { createClient } from '@/lib/supabase-browser'
import { prepareWholesalePayment, paymentMoneyInput } from '@/lib/wholesale-payment'
import {
  sessionContextResponseSchema,
  wholesalePaymentsContextSchema,
  wholesalePaymentAllocationRequestSchema,
  wholesalePaymentAllocationResponseSchema,
  type WholesalePaymentsContext,
  type WholesalePaymentAllocationRequest,
} from '@hcs/contracts'
import { formatPeso } from '@hcs/ui'
import { ArrowLeft, RefreshCw, Save } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'

const apiUrl = process.env.NEXT_PUBLIC_API_URL
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const inputClass = 'w-full min-w-0 rounded border border-ink-900/20 bg-white px-3 py-2 disabled:opacity-60'
type Pending = { key: string; request: WholesalePaymentAllocationRequest }
class PaymentRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
  }
}

async function call(path: string, token: string, tenant: string, options: RequestInit = {}) {
  if (!apiUrl) throw new Error('Back Office API is not configured.')
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenant, ...options.headers },
  })
  const data: unknown = await response.json()
  if (!response.ok) {
    const error = (data as { error?: { message?: string; code?: string } }).error
    throw new PaymentRequestError(error?.message ?? 'Request failed.', error?.code ?? '')
  }
  return data
}

export function WholesalePaymentsWorkspace() {
  const [auth] = useState(() => (supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null))
  const [scope, setScope] = useState<{ tenant: string; user: string } | null>(null)
  const [context, setContext] = useState<WholesalePaymentsContext | null>(null)
  const [customer, setCustomer] = useState('')
  const [method, setMethod] = useState('')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const lock = useRef(false)
  const storageKey = (tenant: string, user: string) => `hcs:wholesale-payment:${tenant}:${user}`

  async function token() {
    if (!auth) throw new Error('Authentication is not configured.')
    const { data, error: sessionError } = await auth.auth.getSession()
    if (sessionError) throw sessionError
    if (!data.session || (scope && data.session.user.id !== scope.user))
      throw new Error('Sign in to the original account.')
    return data.session.access_token
  }

  useEffect(() => {
    let active = true
    async function initialize() {
      try {
        if (!auth) throw new Error('Authentication is not configured.')
        const { data, error: sessionError } = await auth.auth.getSession()
        if (sessionError) throw sessionError
        if (!data.session) throw new Error('Sign in to view wholesale payments.')
        const session = sessionContextResponseSchema.parse(await call('/v1/me', data.session.access_token, ''))
        const tenant = selectActiveTenant(session.tenants)
        if (!tenant) throw new Error('Select a business first.')
        const next = wholesalePaymentsContextSchema.parse(
          await call('/v1/wholesale/payments', data.session.access_token, tenant.tenantId),
        )
        if (!active) return
        setScope({ tenant: tenant.tenantId, user: data.session.user.id })
        setContext(next)
        setMethod(next.paymentMethods[0]?.id ?? '')
        const saved = sessionStorage.getItem(storageKey(tenant.tenantId, data.session.user.id))
        if (saved) {
          const value = JSON.parse(saved) as Pending
          const request = wholesalePaymentAllocationRequestSchema.parse(value.request)
          if (!/^wholesale-payment-[a-f0-9-]{36}$/.test(value.key)) throw new Error('Invalid pending receipt key.')
          setPending({ key: value.key, request })
          setCustomer(request.customerId)
          setMethod(request.paymentMethodId)
          setAmount(paymentMoneyInput(request.amountMinor))
          setReference(request.reference)
          setAllocations(
            Object.fromEntries(
              request.allocations.map((item) => [item.invoiceId, paymentMoneyInput(item.amountMinor)]),
            ),
          )
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load payments.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void initialize()
    return () => {
      active = false
    }
  }, [auth])

  async function refresh() {
    if (!scope || lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      setContext(
        wholesalePaymentsContextSchema.parse(await call('/v1/wholesale/payments', await token(), scope.tenant)),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not refresh payments.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  async function record(event: FormEvent) {
    event.preventDefault()
    if (!scope || !context || lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const command = pending ?? {
        key: `wholesale-payment-${crypto.randomUUID()}`,
        request: prepareWholesalePayment(context, customer, method, amount, reference, allocations),
      }
      // Keep the same command after a network failure or reload, never create a second receipt on retry.
      sessionStorage.setItem(storageKey(scope.tenant, scope.user), JSON.stringify(command))
      setPending(command)
      const result = wholesalePaymentAllocationResponseSchema.parse(
        await call('/v1/wholesale/payments', await token(), scope.tenant, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': command.key },
          body: JSON.stringify(command.request),
        }),
      )
      sessionStorage.removeItem(storageKey(scope.tenant, scope.user))
      setPending(null)
      setAmount('')
      setReference('')
      setAllocations({})
      setMessage(`Payment recorded: ${formatPeso(result.amountMinor)}. Receipt ${result.paymentId}.`)
      setContext(
        wholesalePaymentsContextSchema.parse(await call('/v1/wholesale/payments', await token(), scope.tenant)),
      )
    } catch (cause) {
      if (cause instanceof PaymentRequestError && /^WHOLESALE_PAYMENT_HCAP[1-5]$/.test(cause.code)) {
        sessionStorage.removeItem(storageKey(scope.tenant, scope.user))
        setPending(null)
      }
      setError(cause instanceof Error ? cause.message : 'Could not record payment.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const customers = Array.from(
    new Map(context?.invoices.map((item) => [item.customerId, item.customerName]) ?? []).entries(),
  )
  const invoices = context?.invoices.filter((item) => item.customerId === customer) ?? []
  const payments = context?.payments.filter((item) => !customer || item.customerId === customer) ?? []
  const disabled = busy || !!pending || !context?.canRecord
  return (
    <div className="min-w-0 space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between gap-4">
        <Link href="/wholesale" className="inline-flex items-center gap-2">
          <ArrowLeft size={18} />
          Orders
        </Link>
        <button
          type="button"
          title="Refresh payments"
          aria-label="Refresh payments"
          onClick={() => void refresh()}
          disabled={busy || loading}
          className="grid size-10 place-items-center rounded border border-ink-900/20"
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {error && (
        <p role="alert" className="border-l-2 border-red-500 bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="border-l-2 border-emerald-600 bg-emerald-50 p-3 text-emerald-800 break-words">
          {message}
        </p>
      )}
      {loading ? (
        <p role="status">Loading payments...</p>
      ) : (
        context && (
          <>
            <label className="block max-w-lg space-y-1">
              <span>Customer</span>
              <select
                aria-label="Customer"
                className={inputClass}
                value={customer}
                disabled={busy || !!pending}
                onChange={(event) => {
                  setCustomer(event.target.value)
                  setAllocations({})
                }}
              >
                <option value="">All customers</option>
                {customers.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <section className="border-y border-ink-900/15 py-5">
              <h2 className="mb-4 text-xl font-semibold">Record received payment</h2>
              {!context.canRecord && <p className="mb-3 text-ink-500">Read-only access</p>}
              <form onSubmit={(event) => void record(event)} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="space-y-1">
                    <span>Payment method</span>
                    <select
                      className={inputClass}
                      value={method}
                      disabled={disabled}
                      onChange={(event) => setMethod(event.target.value)}
                      required
                    >
                      <option value="">Select method</option>
                      {context.paymentMethods.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span>Amount received (PHP)</span>
                    <input
                      className={inputClass}
                      inputMode="decimal"
                      value={amount}
                      disabled={disabled}
                      onChange={(event) => setAmount(event.target.value)}
                      required
                    />
                  </label>
                  <label className="space-y-1">
                    <span>Payment reference</span>
                    <input
                      className={inputClass}
                      maxLength={100}
                      value={reference}
                      disabled={disabled}
                      onChange={(event) => setReference(event.target.value)}
                      required
                    />
                  </label>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-ink-900/15">
                        <th className="py-3">Invoice / location</th>
                        <th>Due date</th>
                        <th>Open balance</th>
                        <th className="w-40">Allocate (PHP)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((item) => (
                        <tr key={item.invoiceId} className="border-b border-ink-900/10">
                          <td className="py-3">
                            {item.invoiceNumber}
                            <span className="block text-ink-500">{item.locationName}</span>
                          </td>
                          <td>{item.dueDate ?? 'Unclassified'}</td>
                          <td>{item.openBalanceMinor === null ? 'Unclassified' : formatPeso(item.openBalanceMinor)}</td>
                          <td>
                            <input
                              aria-label={`Allocation for ${item.invoiceNumber}`}
                              className={inputClass}
                              inputMode="decimal"
                              value={allocations[item.invoiceId] ?? ''}
                              disabled={disabled || !item.canAllocate || !item.openBalanceMinor}
                              onChange={(event) =>
                                setAllocations({ ...allocations, [item.invoiceId]: event.target.value })
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!invoices.length && <p className="text-ink-500">{customer ? 'No invoices.' : 'Select a customer.'}</p>}
                <button
                  type="submit"
                  disabled={busy || !context.canRecord || !customer}
                  className="inline-flex min-h-10 items-center gap-2 rounded bg-ink-900 px-4 py-2 text-white disabled:opacity-50"
                >
                  <Save size={18} />
                  {busy ? 'Recording...' : pending ? 'Retry pending payment' : 'Record payment'}
                </button>
              </form>
            </section>
            <section>
              <h2 className="mb-4 text-xl font-semibold">Receipt history</h2>
              {!payments.length && <p className="text-ink-500">No recorded payments.</p>}
              {payments.map((item) => (
                <details key={item.paymentId} className="border-b border-ink-900/15 py-3">
                  <summary className="cursor-pointer">
                    <span className="font-semibold">
                      {item.customerName} · {formatPeso(item.amountMinor)}
                    </span>
                    <span className="ml-3 text-sm text-ink-500">
                      {new Date(item.recordedAt).toLocaleString()} · {item.paymentMethodName}
                    </span>
                  </summary>
                  <p className="mt-3 break-words text-sm">Receipt {item.paymentId}</p>
                  <p className="my-2 break-words text-sm">{item.reference}</p>
                  <ul className="space-y-2 text-sm">
                    {item.allocations.map((allocation) => (
                      <li key={allocation.invoiceId} className="flex flex-wrap justify-between gap-2">
                        <span>{allocation.invoiceNumber}</span>
                        <strong>{formatPeso(allocation.amountMinor)}</strong>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </section>
          </>
        )
      )}
    </div>
  )
}
