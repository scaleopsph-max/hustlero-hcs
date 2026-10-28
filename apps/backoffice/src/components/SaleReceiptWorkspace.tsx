'use client'

import { selectActiveTenant } from '@/lib/active-tenant'

import { createClient } from '@/lib/supabase-browser'
import { ArrowLeft, Printer, RotateCcw, XCircle } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SaleReversalError,
  canDiscardRejectedReversal,
  decodePendingReversal,
  pendingSaleReversalSchema,
  quantityToMilli,
  quoteSaleReversal,
  type PendingSaleReversal,
} from '@/lib/sale-reversal'
import {
  saleReceiptDetailSchema,
  saleReversalResponseSchema,
  sessionContextResponseSchema,
  type SaleReceiptDetail,
} from '@hcs/contracts'
import { Button, Chip, Glass, formatPeso } from '@hcs/ui'

const apiUrl = process.env.NEXT_PUBLIC_API_URL
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

type Mode = 'refund' | 'void' | null

async function request(path: string, token: string, tenantId: string, init?: RequestInit) {
  if (!apiUrl) throw new Error('Back Office API URL is not configured.')
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-Id': tenantId,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const data: unknown = await response.json()
  if (!response.ok) {
    const error = (data as { error?: { message?: string; code?: string } }).error
    throw new SaleReversalError(error?.message ?? 'Request failed.', error?.code ?? 'UNKNOWN')
  }
  return data
}

function statusTone(status: SaleReceiptDetail['status']) {
  if (status === 'completed') return 'success' as const
  if (status === 'partially_refunded') return 'warning' as const
  return 'neutral' as const
}

export function SaleReceiptWorkspace({ saleId }: { saleId: string }) {
  const [receipt, setReceipt] = useState<SaleReceiptDetail | null>(null)
  const [token, setToken] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [actorId, setActorId] = useState('')
  const [pending, setPending] = useState<PendingSaleReversal | null>(null)
  const [recoveryBlocked, setRecoveryBlocked] = useState(false)
  const [discardable, setDiscardable] = useState(false)
  const commandLock = useRef(false)
  const mounted = useRef(true)
  const storage = `hcs-sale-reversal-v1:${tenantId}:${actorId}:${saleId}`
  const [mode, setMode] = useState<Mode>(null)
  const [reason, setReason] = useState('')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [returnToStock, setReturnToStock] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(
    async (accessToken: string, selectedTenantId: string) => {
      const loaded = saleReceiptDetailSchema.parse(await request(`/v1/sales/${saleId}`, accessToken, selectedTenantId))
      if (mounted.current) setReceipt(loaded)
      return loaded
    },
    [saleId],
  )

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!supabaseUrl || !supabaseKey) {
      setError('Back Office authentication is not configured.')
      setLoading(false)
      return
    }
    const auth = createClient(supabaseUrl, supabaseKey)
    void auth.auth.getSession().then(async ({ data, error: sessionError }) => {
      try {
        if (sessionError) throw sessionError
        if (!data.session) throw new Error('Sign in to view this receipt.')
        const accessToken = data.session.access_token
        const session = sessionContextResponseSchema.parse(await request('/v1/me', accessToken, ''))
        const tenant = selectActiveTenant(session.tenants)
        if (!tenant) throw new Error('Create a business first.')
        setToken(accessToken)
        setActorId(session.userId)
        setTenantId(tenant.tenantId)
        const scope = { actorId: session.userId, tenantId: tenant.tenantId, saleId }
        try {
          const raw = sessionStorage.getItem(`hcs-sale-reversal-v1:${tenant.tenantId}:${session.userId}:${saleId}`)
          if (raw) setPending(decodePendingReversal(raw, scope))
        } catch {
          setRecoveryBlocked(true)
          throw new Error('Pending reversal storage needs reconciliation before another command.')
        }
        await load(accessToken, tenant.tenantId)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load the receipt.')
      } finally {
        setLoading(false)
      }
    })
  }, [load, saleId])

  const selections = useMemo(
    () =>
      receipt?.lines
        .map((line) => ({
          saleLineId: line.id,
          quantityMilli: Number(quantities[line.id] ?? 0),
          returnToStock: returnToStock[line.id] ?? true,
        }))
        .filter((line) => line.quantityMilli > 0) ?? [],
    [receipt, quantities, returnToStock],
  )

  const preview = useMemo(() => {
    if (!receipt) return { amount: 0, error: null }
    try {
      const selected =
        mode === 'void'
          ? receipt.lines
              .filter((line) => line.refundableQuantityMilli > 0)
              .map((line) => ({
                saleLineId: line.id,
                quantityMilli: line.refundableQuantityMilli,
                returnToStock: true,
              }))
          : selections
      return { amount: quoteSaleReversal(receipt, selected), error: null }
    } catch (cause) {
      return { amount: 0, error: cause instanceof Error ? cause.message : 'Invalid refund selection.' }
    }
  }, [receipt, selections, mode])

  async function executeReversal(command: PendingSaleReversal) {
    if (commandLock.current) return
    commandLock.current = true
    setBusy(true)
    setError(null)
    setDiscardable(false)
    try {
      const original = JSON.stringify(command)
      const restored = decodePendingReversal(sessionStorage.getItem(storage) ?? '', { actorId, tenantId, saleId })
      if (JSON.stringify(restored) !== original) throw new Error('Pending reversal changed; reconciliation required.')
      const response = saleReversalResponseSchema.parse(
        await request(`/v1/sales/${saleId}/${command.mode === 'refund' ? 'refunds' : 'void'}`, token, tenantId, {
          method: 'POST',
          headers: { 'Idempotency-Key': command.key },
          body: command.body,
        }),
      )
      if (
        response.saleId !== saleId ||
        response.type !== command.mode ||
        response.amountCentavos !== command.expectedAmountMinor
      )
        throw new Error('Reversal response does not match the original request; keep it for reconciliation.')
      if (!mounted.current) return
      const refreshed = await load(token, tenantId)
      if (!mounted.current) return
      if (
        !refreshed.reversals.some(
          (row) =>
            row.id === response.reversalId &&
            row.type === command.mode &&
            row.amountCentavos === response.amountCentavos,
        )
      )
        throw new Error('Reversal was not verified in receipt history; retry only the original request.')
      if (sessionStorage.getItem(storage) !== original) throw new Error('Pending reversal storage changed.')
      sessionStorage.removeItem(storage)
      setPending(null)
      setMode(null)
      setReason('')
      setQuantities({})
      setNotice(
        `${command.mode === 'refund' ? 'Refund recorded' : 'Receipt voided'}: ${formatPeso(response.amountCentavos)}.`,
      )
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : 'Unknown reversal outcome. Retry only the original request.')
        setDiscardable(canDiscardRejectedReversal(cause))
      }
    } finally {
      commandLock.current = false
      if (mounted.current) setBusy(false)
    }
  }

  async function submitReversal() {
    if (!receipt || receipt.id !== saleId || !mode || pending || recoveryBlocked || commandLock.current) return
    try {
      if (!receipt.canReverse || reason.trim().length < 3 || preview.error)
        throw new Error(preview.error ?? 'Enter a reason and select an eligible receipt.')
      const command = pendingSaleReversalSchema.parse({
        version: 1,
        actorId,
        tenantId,
        saleId,
        key: crypto.randomUUID(),
        mode,
        expectedAmountMinor: preview.amount,
        body: JSON.stringify(
          mode === 'refund' ? { reason: reason.trim(), lines: selections } : { reason: reason.trim() },
        ),
      })
      if (sessionStorage.getItem(storage)) throw new Error('An earlier reversal needs reconciliation.')
      sessionStorage.setItem(storage, JSON.stringify(command))
      setPending(command)
      await executeReversal(command)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare reversal.')
    }
  }

  if (loading)
    return (
      <Glass variant="light" className="p-8 text-sm text-ink-500">
        Loading receipt...
      </Glass>
    )
  if (!receipt) return <div className="border-l-2 border-red-600 bg-red-50 p-4 text-sm text-red-800">{error}</div>

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href="/sales"
          className="inline-flex items-center gap-2 text-sm font-semibold text-ink-700 hover:text-ink-950"
        >
          <ArrowLeft size={17} /> Sales
        </Link>
        <div className="flex flex-wrap gap-2">
          {receipt.channel === 'wholesale' && (
            <Link
              href="/wholesale/returns"
              className="inline-flex items-center gap-2 text-sm font-semibold text-ink-700 hover:text-ink-950"
            >
              <RotateCcw size={16} /> Returns and credits
            </Link>
          )}
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer size={16} /> Reprint
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !!pending || recoveryBlocked || !receipt.canReverse || receipt.channel === 'wholesale'}
            onClick={() => {
              setMode('refund')
              setError(null)
            }}
          >
            <RotateCcw size={16} /> Refund items
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={
              busy ||
              !!pending ||
              recoveryBlocked ||
              !receipt.canReverse ||
              receipt.channel === 'wholesale' ||
              receipt.status !== 'completed'
            }
            onClick={() => {
              setMode('void')
              setError(null)
            }}
          >
            <XCircle size={16} /> Void sale
          </Button>
        </div>
      </div>

      {notice ? (
        <div className="border-l-2 border-emerald-600 bg-emerald-50 p-4 text-sm text-emerald-900 print:hidden">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="border-l-2 border-red-600 bg-red-50 p-4 text-sm text-red-800 print:hidden">{error}</div>
      ) : null}
      {!receipt.canReverse && receipt.reversalBlockedReason ? (
        <div className="border-l-2 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900 print:hidden">
          {receipt.reversalBlockedReason}
        </div>
      ) : null}

      <Glass variant="light" className="print-receipt overflow-hidden p-0">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-900/10 p-6">
          <div>
            <div className="text-xs font-semibold uppercase text-ink-500">
              {receipt.channel === 'wholesale' ? 'Wholesale invoice' : 'Official sale record'}
            </div>
            <h1 className="mt-1 font-display text-2xl font-bold">{receipt.invoiceNumber ?? receipt.receiptNumber}</h1>
            <div className="mt-2">
              <div className="flex flex-wrap gap-2">
                <Chip tone={receipt.channel === 'wholesale' ? 'warning' : 'neutral'}>{receipt.channel}</Chip>
                <Chip tone={statusTone(receipt.status)}>
                  {(receipt.channel === 'wholesale'
                    ? receipt.status.replace('refunded', 'credited')
                    : receipt.status
                  ).replace('_', ' ')}
                </Chip>
              </div>
              {receipt.orderNumber ? (
                <div className="mt-2 text-sm text-ink-500">Order {receipt.orderNumber}</div>
              ) : null}
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="font-semibold">{receipt.locationName}</div>
            <div className="text-ink-500">{receipt.registerName}</div>
            <div className="mt-2 text-ink-500">
              {new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(
                new Date(receipt.completedAt),
              )}
            </div>
            <div className="text-ink-500">
              {receipt.channel === 'wholesale' ? 'Issued by' : 'Cashier'}: {receipt.employeeName}
            </div>
            {receipt.customerId ? (
              <Link href={`/customers/${receipt.customerId}`} className="font-medium underline underline-offset-2">
                Customer: {receipt.customerName} ({receipt.customerNumber})
              </Link>
            ) : (
              <div className="text-ink-500">Customer: Walk-in</div>
            )}
            {receipt.loyaltyEarnedPoints > 0 || receipt.loyaltyReversedPoints > 0 ? (
              <div className="mt-1 text-sm text-ink-500">
                Loyalty: +{receipt.loyaltyEarnedPoints} earned
                {receipt.loyaltyReversedPoints ? ` · -${receipt.loyaltyReversedPoints} reversed` : ''}
              </div>
            ) : null}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-ink-900/10 text-left text-xs uppercase text-ink-500">
              <tr>
                <th className="px-6 py-3">Item</th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-6 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {receipt.lines.map((line) => (
                <tr key={line.id} className="border-b border-ink-900/10 last:border-0">
                  <td className="px-6 py-4">
                    <div className="font-semibold">{line.productName}</div>
                    <div className="text-ink-500">{line.variantName}</div>
                    {line.pricingType ? (
                      <div className="text-xs capitalize text-ink-500">{line.pricingType}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-4">{line.sku}</td>
                  <td className="px-4 py-4 text-right">{line.quantityMilli / 1000}</td>
                  <td className="px-4 py-4 text-right">{formatPeso(line.unitPriceCentavos)}</td>
                  <td className="px-6 py-4 text-right font-semibold">
                    {formatPeso(
                      receipt.discountReturnSnapshot?.lines.find((row) => row.saleLineId === line.id)?.netMinor ??
                        line.lineTotalCentavos,
                    )}
                    {receipt.discountReturnSnapshot ? (
                      <div className="text-xs font-normal text-ink-500">
                        Gross {formatPeso(line.lineTotalCentavos)} · Discount{' '}
                        {formatPeso(
                          receipt.discountReturnSnapshot.lines.find((row) => row.saleLineId === line.id)
                            ?.discountMinor ?? 0,
                        )}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-6 border-t border-ink-900/10 p-6 sm:grid-cols-2">
          <div className="text-sm">
            <div className="font-semibold">{receipt.channel === 'wholesale' ? 'Payment status' : 'Payment'}</div>
            {receipt.channel === 'wholesale' && receipt.payments.length === 0 ? (
              <div className="mt-2 text-ink-600">Payment terms and allocations are introduced in AW3.</div>
            ) : null}
            {receipt.payments.map((payment) => (
              <div key={payment.id} className="mt-2 text-ink-600">
                {payment.methodName}: {formatPeso(payment.amountCentavos)}
                {payment.refundedCentavos ? ` · Refunded ${formatPeso(payment.refundedCentavos)}` : ''}
              </div>
            ))}
          </div>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-2 text-sm sm:justify-self-end sm:min-w-72">
            <dt>Subtotal</dt>
            <dd className="text-right">{formatPeso(receipt.subtotalCentavos)}</dd>
            <dt>
              Discount{' '}
              {receipt.discountDefinitionSnapshot
                ? `· ${receipt.discountDefinitionSnapshot.name} (v${receipt.discountDefinitionSnapshot.revision})`
                : ''}
            </dt>
            <dd className="text-right">{formatPeso(receipt.discountCentavos)}</dd>
            <dt>Tax</dt>
            <dd className="text-right">{formatPeso(receipt.taxCentavos)}</dd>
            <dt className="border-t border-ink-900/10 pt-2 font-bold">Total</dt>
            <dd className="border-t border-ink-900/10 pt-2 text-right font-bold">
              {formatPeso(receipt.totalCentavos)}
            </dd>
            {receipt.refundedCentavos ? (
              <>
                <dt className="text-red-700">{receipt.channel === 'wholesale' ? 'Credited' : 'Refunded'}</dt>
                <dd className="text-right text-red-700">-{formatPeso(receipt.refundedCentavos)}</dd>
              </>
            ) : null}
          </dl>
        </div>
      </Glass>

      {pending ? (
        <section className="border border-amber-600 p-5 print:hidden" role="status">
          <p>
            Pending {pending.mode}: {formatPeso(pending.expectedAmountMinor)}. Retry only the original request; do not
            pay again.
          </p>
          <Button disabled={busy} onClick={() => void executeReversal(pending)}>
            Retry original reversal
          </Button>
          {discardable ? (
            <Button
              disabled={busy}
              variant="secondary"
              onClick={() => {
                if (sessionStorage.getItem(storage) !== JSON.stringify(pending)) {
                  setError('Pending storage changed.')
                  return
                }
                sessionStorage.removeItem(storage)
                setPending(null)
                setDiscardable(false)
              }}
            >
              Discard rejected request
            </Button>
          ) : null}
        </section>
      ) : null}
      {mode && !pending && !recoveryBlocked ? (
        <section className="border border-ink-900/15 bg-white p-6 print:hidden">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase text-ink-500">Controlled reversal</div>
              <h2 className="mt-1 font-display text-xl font-bold">
                {mode === 'refund' ? 'Refund selected items' : 'Void entire sale'}
              </h2>
            </div>
            <button
              type="button"
              aria-label="Close reversal form"
              onClick={() => setMode(null)}
              className="p-2 text-ink-500 hover:text-ink-950"
            >
              <XCircle size={20} />
            </button>
          </div>
          {mode === 'refund' ? (
            <div className="mt-5 grid gap-3">
              {receipt.lines
                .filter((line) => line.refundableQuantityMilli > 0)
                .map((line) => (
                  <div
                    key={line.id}
                    className="grid items-end gap-3 border-b border-ink-900/10 pb-3 sm:grid-cols-[1fr_150px_170px]"
                  >
                    <div>
                      <div className="font-semibold">
                        {line.productName} · {line.variantName}
                      </div>
                      <div className="text-sm text-ink-500">Up to {line.refundableQuantityMilli / 1000} refundable</div>
                    </div>
                    <label className="text-sm">
                      Quantity
                      <input
                        type="number"
                        min="0"
                        max={line.refundableQuantityMilli / 1000}
                        step="0.001"
                        value={Number(quantities[line.id] ?? 0) / 1000 || ''}
                        onChange={(event) => {
                          try {
                            const value = quantityToMilli(event.target.value)
                            setQuantities((current) => ({ ...current, [line.id]: String(value) }))
                            setError(null)
                          } catch (cause) {
                            setError(cause instanceof Error ? cause.message : 'Invalid quantity.')
                          }
                        }}
                        className="mt-1 w-full border border-ink-900/20 px-3 py-2"
                      />
                    </label>
                    <label className="flex items-center gap-2 pb-2 text-sm">
                      <input
                        type="checkbox"
                        checked={returnToStock[line.id] ?? true}
                        onChange={(event) =>
                          setReturnToStock((current) => ({ ...current, [line.id]: event.target.checked }))
                        }
                      />{' '}
                      Return to stock
                    </label>
                  </div>
                ))}
            </div>
          ) : (
            <p className="mt-4 max-w-2xl text-sm text-ink-600">
              This reverses the full payment and returns all remaining quantities to stock. The original receipt remains
              in history.
            </p>
          )}
          <label className="mt-5 block text-sm font-semibold">
            Reason
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={240}
              rows={3}
              className="mt-2 w-full border border-ink-900/20 px-3 py-2 font-normal"
              placeholder={mode === 'refund' ? 'Why are these items being refunded?' : 'Why is this sale being voided?'}
            />
          </label>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <strong>
              {mode === 'refund'
                ? `Refund total ${formatPeso(preview.amount)}`
                : `Reverse ${formatPeso(receipt.refundableCentavos)}`}
            </strong>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setMode(null)} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => void submitReversal()}
                disabled={busy || !!preview.error || reason.trim().length < 3}
              >
                {busy ? 'Recording...' : mode === 'refund' ? 'Confirm refund' : 'Confirm void'}
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {receipt.reversals.length ? (
        <section className="print:hidden">
          <h2 className="font-display text-lg font-bold">Reversal history</h2>
          <div className="mt-3 divide-y divide-ink-900/10 border-y border-ink-900/10">
            {receipt.reversals.map((entry) => (
              <div key={entry.id} className="grid gap-2 py-3 text-sm sm:grid-cols-[120px_1fr_150px]">
                <strong className="capitalize">{entry.type}</strong>
                <span>{entry.reason}</span>
                <span className="text-right">{formatPeso(entry.amountCentavos)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
