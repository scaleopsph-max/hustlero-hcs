'use client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowLeft, Ban, Check, RefreshCw } from 'lucide-react'
import {
  sessionContextResponseSchema,
  wholesaleOrderContextSchema,
  wholesaleCreditOverridesContextSchema,
  type WholesaleOrderContext,
  type WholesaleCreditOverridesContext,
} from '@hcs/contracts'
import { formatPeso } from '@hcs/ui'
import { createClient } from '@/lib/supabase-browser'
import { selectActiveTenant } from '@/lib/active-tenant'
import {
  pendingOverrideCommandSchema,
  eligibleOverrideOrders,
  prepareOverrideApproval,
  prepareOverrideRevocation,
  overrideCommandPath,
  overrideCommandDefinitivelyRejected,
  validateOverrideResponse,
  type PendingOverrideCommand,
} from '@/lib/wholesale-override-commands'
const api = process.env.NEXT_PUBLIC_API_URL,
  url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const field = 'w-full min-w-0 rounded border border-ink-900/20 bg-white px-3 py-2'
const button =
  'inline-flex items-center gap-2 rounded border border-ink-900/20 bg-white px-3 py-2 text-sm disabled:opacity-40'
async function call(path: string, token: string, tenant: string, command?: PendingOverrideCommand) {
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
  const data: unknown = await response.json()
  if (!response.ok)
    throw Object.assign(
      new Error((data as { error?: { message?: string } }).error?.message ?? 'Could not load credit approvals.'),
      { code: (data as { error?: { code?: string } }).error?.code },
    )
  return data
}
export function WholesaleOverrideCommandsWorkspace() {
  const [auth] = useState(() => (url && key ? createClient(url, key) : null))
  const [scope, setScope] = useState<{ user: string; tenant: string; storage: string } | null>(null)
  const [context, setContext] = useState<WholesaleCreditOverridesContext | null>(null),
    [orders, setOrders] = useState<WholesaleOrderContext | null>(null)
  const [action, setAction] = useState(''),
    [orderId, setOrderId] = useState(''),
    [amount, setAmount] = useState(''),
    [expiry, setExpiry] = useState(''),
    [reason, setReason] = useState('')
  const [overrideId, setOverrideId] = useState(''),
    [revokeReason, setRevokeReason] = useState(''),
    [attested, setAttested] = useState(false),
    [revokeAttested, setRevokeAttested] = useState(false)
  const [pending, setPending] = useState<PendingOverrideCommand | null>(null),
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
    const next = wholesaleCreditOverridesContextSchema.parse(
      await call('/v1/wholesale/credit-overrides', token, tenant),
    )
    const nextOrders = next.canApprove
      ? wholesaleOrderContextSchema.parse(await call('/v1/wholesale/orders', token, tenant))
      : null
    return { context: next, orders: nextOrders }
  }
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        if (!auth) throw new Error('Authentication is not configured.')
        const { data, error: sessionError } = await auth.auth.getSession()
        if (sessionError) throw sessionError
        if (!data.session) throw new Error('Sign in to manage credit approvals.')
        const access = sessionContextResponseSchema.parse(await call('/v1/me', data.session.access_token, ''))
        const tenant = selectActiveTenant(access.tenants)
        if (!tenant) throw new Error('Select a business first.')
        const storage = `hcs-wholesale-overrides:${data.session.user.id}:${tenant.tenantId}`
        const stored = sessionStorage.getItem(storage),
          restored = stored ? pendingOverrideCommandSchema.parse(JSON.parse(stored)) : null
        if (active) {
          setScope({ user: data.session.user.id, tenant: tenant.tenantId, storage })
          setPending(restored)
        }
        const next = await load(data.session.access_token, tenant.tenantId)
        if (active) {
          setContext(next.context)
          setOrders(next.orders)
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load approvals.')
      } finally {
        if (active) setBusy(false)
      }
    })()
    return () => {
      active = false
    }
  }, [auth])
  async function session() {
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
    setContext(null)
    setOrders(null)
    try {
      const current = await session(),
        next = await load(current.access_token, scope.tenant)
      if (mounted.current) {
        setContext(next.context)
        setOrders(next.orders)
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not refresh approvals.')
    } finally {
      locked.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function submit(kind: PendingOverrideCommand['kind'], event?: FormEvent) {
    event?.preventDefault()
    if (!scope || !context?.canApprove || locked.current || (pending && pending.kind !== kind)) return
    locked.current = true
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const current = await session()
      let command = pending
      if (!command) {
        if (!(kind === 'approve' ? attested : revokeAttested))
          throw new Error('Confirm this credit exception before submitting.')
        command =
          kind === 'approve'
            ? {
                kind,
                key: crypto.randomUUID(),
                payload: prepareOverrideApproval(
                  context,
                  orders?.orders ?? [],
                  orderId,
                  action,
                  amount,
                  expiry,
                  reason,
                ),
              }
            : {
                kind,
                key: crypto.randomUUID(),
                overrideId,
                payload: prepareOverrideRevocation(context, overrideId, revokeReason),
              }
        sessionStorage.setItem(scope.storage, JSON.stringify(command))
        setPending(command)
      }
      const result = validateOverrideResponse(
        command,
        await call(overrideCommandPath(command), current.access_token, scope.tenant, command),
      )
      sessionStorage.removeItem(scope.storage)
      if (!mounted.current) return
      setPending(null)
      setAttested(false)
      setRevokeAttested(false)
      setReason('')
      setRevokeReason('')
      setMessage(
        `${kind === 'approve' ? 'Credit exception approved' : 'Credit exception revoked'}: ${result.overrideId}`,
      )
      setContext(null)
      setOrders(null)
      const next = await load(current.access_token, scope.tenant)
      if (mounted.current) {
        setContext(next.context)
        setOrders(next.orders)
      }
    } catch (cause) {
      if (overrideCommandDefinitivelyRejected((cause as { code?: string }).code)) {
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
  const disabled = busy || !!pending || !context?.canApprove
  const candidates = eligibleOverrideOrders(orders?.orders ?? [], action)
  const selected = context?.overrides.find((row) => row.overrideId === overrideId)
  return (
    <section className="min-w-0 space-y-6 p-4 md:p-6">
      <div className="flex justify-between gap-3">
        <Link href="/wholesale/approvals" className="inline-flex items-center gap-2 text-sm">
          <ArrowLeft size={18} />
          Approval history
        </Link>
        <button
          title="Refresh approval context"
          aria-label="Refresh approval context"
          disabled={busy || !scope}
          onClick={() => void refresh()}
          className={button}
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
        <p role="status" className="break-all border-l-2 border-emerald-500 bg-emerald-50 p-3 text-sm">
          {message}
        </p>
      )}
      {busy && <p role="status">Loading credit approvals...</p>}
      {pending && (
        <div className="space-y-2 border-l-2 border-amber-500 bg-amber-50 p-3 text-sm">
          <p className="break-all">
            Pending {pending.kind}: {pending.kind === 'approve' ? pending.payload.salesOrderId : pending.overrideId}
          </p>
          <p className="break-words">{pending.payload.reason}</p>
          {pending.kind === 'approve' && (
            <p>
              {pending.payload.action} / {formatPeso(pending.payload.approvedExcessMinor)} / {pending.payload.expiresAt}
            </p>
          )}
          <button className={button} disabled={busy || !context?.canApprove} onClick={() => void submit(pending.kind)}>
            <RefreshCw size={18} />
            Retry original request
          </button>
        </div>
      )}
      {context && !context.canApprove && <p className="text-sm">Read-only approval access.</p>}
      {context?.canApprove && (
        <>
          <form
            onSubmit={(event) => void submit('approve', event)}
            className="space-y-4 border-y border-ink-900/15 py-5"
          >
            <h2 className="text-lg font-semibold">Approve credit exception</h2>
            <fieldset disabled={disabled} className="grid min-w-0 gap-4 sm:grid-cols-2">
              <label className="min-w-0 space-y-1 text-sm">
                <span>Action</span>
                <select
                  aria-label="Approval action"
                  className={field}
                  value={action}
                  onChange={(event) => {
                    setAction(event.target.value)
                    setOrderId('')
                    setAttested(false)
                  }}
                >
                  <option value="">Select action</option>
                  <option value="confirm">Confirmation</option>
                  <option value="fulfill">Fulfillment</option>
                </select>
              </label>
              <label className="min-w-0 space-y-1 text-sm">
                <span>Order</span>
                <select
                  aria-label="Approval order"
                  className={field}
                  value={orderId}
                  onChange={(event) => {
                    setOrderId(event.target.value)
                    setAttested(false)
                  }}
                >
                  <option value="">Select order</option>
                  {candidates.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.orderNumber} / {row.customerName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 space-y-1 text-sm">
                <span>Approved excess (PHP)</span>
                <input
                  aria-label="Approved excess (PHP)"
                  inputMode="decimal"
                  className={field}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
              <label className="min-w-0 space-y-1 text-sm">
                <span>Expiry (local time)</span>
                <input
                  aria-label="Approval expiry"
                  type="datetime-local"
                  className={field}
                  value={expiry}
                  onChange={(event) => setExpiry(event.target.value)}
                />
              </label>
              <label className="min-w-0 space-y-1 text-sm sm:col-span-2">
                <span>Reason</span>
                <textarea
                  aria-label="Approval reason"
                  maxLength={500}
                  className={field}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} />I
                approve this order/action exception up to the entered excess and expiry.
              </label>
            </fieldset>
            <button className={button} disabled={disabled} type="submit">
              <Check size={18} />
              Approve exception
            </button>
          </form>
          <form
            onSubmit={(event) => void submit('revoke', event)}
            className="space-y-4 border-b border-ink-900/15 pb-5"
          >
            <h2 className="text-lg font-semibold">Revoke credit exception</h2>
            <fieldset disabled={disabled} className="min-w-0 space-y-4">
              <label className="block min-w-0 space-y-1 text-sm">
                <span>Approval</span>
                <select
                  aria-label="Approval to revoke"
                  className={field}
                  value={overrideId}
                  onChange={(event) => {
                    setOverrideId(event.target.value)
                    setRevokeAttested(false)
                  }}
                >
                  <option value="">Select approval</option>
                  {context.overrides
                    .filter((row) => !row.revokedAt)
                    .map((row) => (
                      <option key={row.overrideId} value={row.overrideId}>
                        {row.orderNumber} / {row.action} / {formatPeso(row.approvedExcessMinor)} / {row.status} /{' '}
                        {row.overrideId}
                      </option>
                    ))}
                </select>
              </label>
              {selected && <p className="break-words text-sm">{selected.reason}</p>}
              <label className="block space-y-1 text-sm">
                <span>Reason</span>
                <textarea
                  aria-label="Revocation reason"
                  maxLength={500}
                  className={field}
                  value={revokeReason}
                  onChange={(event) => setRevokeReason(event.target.value)}
                />
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={revokeAttested}
                  onChange={(event) => setRevokeAttested(event.target.checked)}
                />
                I revoke this approval. Existing consumption remains recorded.
              </label>
            </fieldset>
            <button className={button} disabled={disabled} type="submit">
              <Ban size={18} />
              Revoke exception
            </button>
          </form>
        </>
      )}
    </section>
  )
}
