'use client'

import { createClient } from '@supabase/supabase-js'
import { ArrowLeft, Printer, RotateCcw, XCircle } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-Id': tenantId,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const data: unknown = await response.json()
  if (!response.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? 'Request failed.')
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
      setReceipt(saleReceiptDetailSchema.parse(await request(`/v1/sales/${saleId}`, accessToken, selectedTenantId)))
    },
    [saleId],
  )

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
        const tenant = session.tenants.find((entry) => entry.isOwner) ?? session.tenants[0]
        if (!tenant) throw new Error('Create a business first.')
        setToken(accessToken)
        setTenantId(tenant.tenantId)
        await load(accessToken, tenant.tenantId)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load the receipt.')
      } finally {
        setLoading(false)
      }
    })
  }, [load])

  const selectedRefundCentavos = useMemo(() => {
    if (!receipt) return 0
    return receipt.lines.reduce((sum, line) => {
      const milli = Number(quantities[line.id] ?? 0)
      return sum + Math.round((milli / 1000) * line.unitPriceCentavos)
    }, 0)
  }, [quantities, receipt])

  async function submitRefund() {
    if (!receipt) return
    const lines = receipt.lines
      .map((line) => ({
        saleLineId: line.id,
        quantityMilli: Number(quantities[line.id] ?? 0),
        returnToStock: returnToStock[line.id] ?? true,
      }))
      .filter((line) => Number.isInteger(line.quantityMilli) && line.quantityMilli > 0)
    if (!lines.length || reason.trim().length < 3) {
      setError('Select at least one refund quantity and enter a reason.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = saleReversalResponseSchema.parse(
        await request(`/v1/sales/${saleId}/refunds`, token, tenantId, {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({ reason: reason.trim(), lines }),
        }),
      )
      setNotice(`Refund recorded: ${formatPeso(response.amountCentavos)}.`)
      setMode(null)
      setReason('')
      setQuantities({})
      await load(token, tenantId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record the refund.')
    } finally {
      setBusy(false)
    }
  }

  async function submitVoid() {
    if (reason.trim().length < 3) {
      setError('Enter a void reason.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = saleReversalResponseSchema.parse(
        await request(`/v1/sales/${saleId}/void`, token, tenantId, {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({ reason: reason.trim() }),
        }),
      )
      setNotice(`Receipt voided: ${formatPeso(response.amountCentavos)} reversed.`)
      setMode(null)
      setReason('')
      await load(token, tenantId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not void the receipt.')
    } finally {
      setBusy(false)
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
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer size={16} /> Reprint
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!receipt.canReverse}
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
            disabled={!receipt.canReverse || receipt.status !== 'completed'}
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
            <div className="text-xs font-semibold uppercase text-ink-500">Official sale record</div>
            <h1 className="mt-1 font-display text-2xl font-bold">{receipt.receiptNumber}</h1>
            <div className="mt-2">
              <Chip tone={statusTone(receipt.status)}>{receipt.status.replace('_', ' ')}</Chip>
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
            <div className="text-ink-500">Cashier: {receipt.employeeName}</div>
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
                  </td>
                  <td className="px-4 py-4">{line.sku}</td>
                  <td className="px-4 py-4 text-right">{line.quantityMilli / 1000}</td>
                  <td className="px-4 py-4 text-right">{formatPeso(line.unitPriceCentavos)}</td>
                  <td className="px-6 py-4 text-right font-semibold">{formatPeso(line.lineTotalCentavos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-6 border-t border-ink-900/10 p-6 sm:grid-cols-2">
          <div className="text-sm">
            <div className="font-semibold">Payment</div>
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
            <dt>Discount</dt>
            <dd className="text-right">{formatPeso(receipt.discountCentavos)}</dd>
            <dt>Tax</dt>
            <dd className="text-right">{formatPeso(receipt.taxCentavos)}</dd>
            <dt className="border-t border-ink-900/10 pt-2 font-bold">Total</dt>
            <dd className="border-t border-ink-900/10 pt-2 text-right font-bold">
              {formatPeso(receipt.totalCentavos)}
            </dd>
            {receipt.refundedCentavos ? (
              <>
                <dt className="text-red-700">Refunded</dt>
                <dd className="text-right text-red-700">-{formatPeso(receipt.refundedCentavos)}</dd>
              </>
            ) : null}
          </dl>
        </div>
      </Glass>

      {mode ? (
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
                        onChange={(event) =>
                          setQuantities((current) => ({
                            ...current,
                            [line.id]: String(Math.round(Number(event.target.value) * 1000)),
                          }))
                        }
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
                ? `Refund total ${formatPeso(selectedRefundCentavos)}`
                : `Reverse ${formatPeso(receipt.refundableCentavos)}`}
            </strong>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setMode(null)} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => void (mode === 'refund' ? submitRefund() : submitVoid())}
                disabled={busy}
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
