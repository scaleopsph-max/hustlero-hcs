'use client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check } from 'lucide-react'
import {
  wholesaleFundAllocationRequestSchema,
  wholesaleFundsContextSchema,
  wholesaleFundAllocationResponseSchema,
  type WholesaleFundAllocationRequest,
  type WholesaleFundsContext,
} from '@hcs/contracts'
import { formatPeso } from '@hcs/ui'
import { createClient } from '@/lib/supabase-browser'
import { selectActiveTenant } from '@/lib/active-tenant'
import { sessionContextResponseSchema } from '@hcs/contracts'
import { parsePaymentMoney } from '@/lib/wholesale-payment'
import { fundAllocationDefinitivelyRejected } from '@/lib/wholesale-funds'

const api = process.env.NEXT_PUBLIC_API_URL
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const field = 'w-full min-w-0 rounded border border-ink-900/20 bg-white px-3 py-2'
type Pending = { key: string; payload: WholesaleFundAllocationRequest }
export function WholesaleFundsWorkspace() {
  const [auth] = useState(() => (url && key ? createClient(url, key) : null))
  const [scope, setScope] = useState<{ user: string; tenant: string; storage: string } | null>(null)
  const [data, setData] = useState<WholesaleFundsContext | null>(null)
  const [payment, setPayment] = useState(''),
    [capital, setCapital] = useState(''),
    [operating, setOperating] = useState('')
  const [reference, setReference] = useState(''),
    [reason, setReason] = useState(''),
    [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null)
  const locked = useRef(false)
  async function call(path: string, token: string, tenant: string, request?: Pending) {
    if (!api) throw new Error('Back Office API is not configured.')
    const response = await fetch(`${api.replace(/\/$/, '')}${path}`, {
      method: request ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': tenant,
        ...(request ? { 'Content-Type': 'application/json', 'Idempotency-Key': request.key } : {}),
      },
      ...(request ? { body: JSON.stringify(request.payload) } : {}),
    })
    const result: unknown = await response.json()
    if (!response.ok)
      throw Object.assign(
        new Error((result as { error?: { message?: string } }).error?.message ?? 'Could not load funds.'),
        { code: (result as { error?: { code?: string } }).error?.code },
      )
    return result
  }
  useEffect(() => {
    let active = true
    async function initialize() {
      try {
        if (!auth) throw new Error('Authentication is not configured.')
        const { data: session, error: sessionError } = await auth.auth.getSession()
        if (sessionError) throw sessionError
        if (!session.session) throw new Error('Sign in to view fund allocations.')
        const access = sessionContextResponseSchema.parse(await call('/v1/me', session.session.access_token, ''))
        const tenant = selectActiveTenant(access.tenants)
        if (!tenant) throw new Error('Select a business first.')
        const storage = `hcs-wholesale-funds:${session.session.user.id}:${tenant.tenantId}`
        const stored = sessionStorage.getItem(storage)
        const next = wholesaleFundsContextSchema.parse(
          await call('/v1/wholesale/funds', session.session.access_token, tenant.tenantId),
        )
        if (active) {
          setScope({ user: session.session.user.id, tenant: tenant.tenantId, storage })
          setData(next)
          if (stored) {
            const parsed: unknown = JSON.parse(stored)
            const value = parsed as Pending
            if (typeof value.key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value.key))
              throw new Error('Invalid pending allocation identity.')
            setPending({ key: value.key, payload: wholesaleFundAllocationRequestSchema.parse(value.payload) })
          }
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load funds.')
      } finally {
        if (active) setBusy(false)
      }
    }
    void initialize()
    return () => {
      active = false
    }
  }, [auth])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!auth || !scope || !data?.canManage || locked.current) return
    locked.current = true
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const { data: session, error: sessionError } = await auth.auth.getSession()
      if (sessionError) throw sessionError
      if (!session.session || session.session.user.id !== scope.user)
        throw new Error('Sign in to the original account.')
      let command = pending
      if (!command) {
        const payload = wholesaleFundAllocationRequestSchema.parse({
          paymentId: payment,
          capitalMinor: parsePaymentMoney(capital),
          operatingMinor: parsePaymentMoney(operating),
          settledConfirmed: confirmed,
          settlementReference: reference,
          reason,
        })
        const receipt = data.payments.find((item) => item.paymentId === payment)
        if (
          !receipt ||
          receipt.allocation ||
          BigInt(payload.capitalMinor) + BigInt(payload.operatingMinor) !== BigInt(receipt.amountMinor)
        )
          throw new Error('Split must equal an unallocated receipt exactly.')
        command = { key: crypto.randomUUID(), payload }
        sessionStorage.setItem(scope.storage, JSON.stringify(command))
        setPending(command)
      }
      wholesaleFundAllocationResponseSchema.parse(
        await call('/v1/wholesale/funds', session.session.access_token, scope.tenant, command),
      )
      sessionStorage.removeItem(scope.storage)
      setPending(null)
      setConfirmed(false)
      setMessage('Fund allocation recorded. No bank transfer was made.')
      setData(null)
      setData(
        wholesaleFundsContextSchema.parse(
          await call('/v1/wholesale/funds', session.session.access_token, scope.tenant),
        ),
      )
    } catch (cause) {
      const code = (cause as { code?: string }).code
      if (fundAllocationDefinitivelyRejected(code)) {
        sessionStorage.removeItem(scope.storage)
        setPending(null)
      }
      setError(cause instanceof Error ? cause.message : 'Allocation failed. Retry the original request.')
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  return (
    <div className="min-w-0 space-y-5 p-4 md:p-6">
      <Link href="/wholesale/payments" className="inline-flex items-center gap-2">
        <ArrowLeft size={18} />
        Payments
      </Link>
      {error && (
        <p role="alert" className="border-l-2 border-red-500 bg-red-50 p-3">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="border-l-2 border-emerald-500 bg-emerald-50 p-3">
          {message}
        </p>
      )}
      {busy && <p role="status">Loading funds...</p>}
      {data && (
        <>
          <dl className="grid gap-4 border-y border-ink-900/15 py-4 sm:grid-cols-2">
            {data.funds.map((fund) => (
              <div key={fund.fundType}>
                <dt>{fund.name}</dt>
                <dd className="mt-2 break-words text-2xl font-semibold">{formatPeso(fund.balanceMinor)}</dd>
              </div>
            ))}
          </dl>
          <form onSubmit={(event) => void submit(event)} className="max-w-3xl space-y-4">
            <h2 className="text-xl font-semibold">Allocate settled receipt</h2>
            {pending && (
              <p role="status">
                Pending allocation: {pending.payload.paymentId}. Retry preserves the original split and reference.
              </p>
            )}
            <fieldset disabled={busy || !!pending || !data.canManage} className="min-w-0 space-y-4 disabled:opacity-60">
              <label className="block space-y-1">
                <span>Receipt</span>
                <select
                  aria-label="Receipt"
                  className={field}
                  value={payment}
                  onChange={(event) => setPayment(event.target.value)}
                  required
                >
                  <option value="">Select receipt</option>
                  {data.payments
                    .filter((item) => !item.allocation)
                    .map((item) => (
                      <option key={item.paymentId} value={item.paymentId}>
                        {item.reference} / {formatPeso(item.amountMinor)}
                      </option>
                    ))}
                </select>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1">
                  <span>Capital / COGS amount</span>
                  <input
                    className={field}
                    inputMode="decimal"
                    value={capital}
                    onChange={(event) => setCapital(event.target.value)}
                    required
                  />
                </label>
                <label className="space-y-1">
                  <span>Operating amount</span>
                  <input
                    className={field}
                    inputMode="decimal"
                    value={operating}
                    onChange={(event) => setOperating(event.target.value)}
                    required
                  />
                </label>
              </div>
              <label className="block space-y-1">
                <span>Settlement reference</span>
                <input
                  className={field}
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  minLength={3}
                  maxLength={100}
                  required
                />
              </label>
              <label className="block space-y-1">
                <span>Reason</span>
                <input
                  className={field}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  minLength={3}
                  maxLength={240}
                  required
                />
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  required
                />
                <span>I confirm this receipt is fully settled and available for fund allocation.</span>
              </label>
            </fieldset>
            <button
              type="submit"
              disabled={busy || !data.canManage}
              className="inline-flex items-center gap-2 rounded border border-ink-900/20 px-4 py-2 disabled:opacity-50"
            >
              <Check size={18} />
              {pending ? 'Retry allocation' : 'Confirm allocation'}
            </button>
          </form>
          <section>
            <h2 className="mb-3 text-xl font-semibold">Allocation history</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[500px] text-left text-sm">
                <thead>
                  <tr>
                    <th className="py-3">Receipt</th>
                    <th>Capital / COGS</th>
                    <th>Operating</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments
                    .filter((item) => item.allocation)
                    .map((item) => (
                      <tr key={item.paymentId} className="border-t border-ink-900/10">
                        <td className="py-3">{item.reference}</td>
                        <td>{formatPeso(item.allocation!.capitalMinor)}</td>
                        <td>{formatPeso(item.allocation!.operatingMinor)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
