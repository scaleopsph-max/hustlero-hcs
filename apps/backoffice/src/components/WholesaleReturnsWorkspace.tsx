'use client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowLeft, Calculator, Check, RotateCcw, Download } from 'lucide-react'
import {
  sessionContextResponseSchema,
  wholesaleReturnsContextSchema,
  wholesaleReturnRequestSchema,
  wholesaleReturnPreviewSchema,
  type WholesaleReturnRequest,
  type WholesaleReturnPreview,
  type WholesaleReturnsContext,
} from '@hcs/contracts'
import { formatPeso } from '@hcs/ui'
import { createClient } from '@/lib/supabase-browser'
import { selectActiveTenant } from '@/lib/active-tenant'
import { parsePaymentMoney, paymentMoneyInput } from '@/lib/wholesale-payment'
import {
  pendingWholesaleReturnSchema,
  restoreWholesaleReturn,
  wholesaleReturnPath,
  reconcileWholesaleReturn,
  type PendingWholesaleReturn,
} from '@/lib/wholesale-returns'

const api = process.env.NEXT_PUBLIC_API_URL
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const field = 'w-full min-w-0 rounded border border-ink-900/20 bg-white px-3 py-2'
export function WholesaleReturnsWorkspace() {
  const [auth] = useState(() => (url && key ? createClient(url, key) : null))
  const [scope, setScope] = useState<{ user: string; tenant: string; storage: string } | null>(null)
  const [data, setData] = useState<WholesaleReturnsContext | null>(null)
  const [mode, setMode] = useState<'return' | 'apply' | 'refund'>('return')
  const [invoice, setInvoice] = useState(''),
    [note, setNote] = useState(''),
    [method, setMethod] = useState(''),
    [register, setRegister] = useState('')
  const [amount, setAmount] = useState(''),
    [reason, setReason] = useState(''),
    [reference, setReference] = useState(''),
    [confirmed, setConfirmed] = useState(false)
  const [quantities, setQuantities] = useState<Record<string, string>>({}),
    [restock, setRestock] = useState<Record<string, boolean>>({})
  const [pending, setPending] = useState<PendingWholesaleReturn | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null)
  const lock = useRef(false)
  const [canDismiss, setCanDismiss] = useState(false)
  const [preview, setPreview] = useState<{ signature: string; result: WholesaleReturnPreview } | null>(null)
  const previewSignature = JSON.stringify({ invoice, reason, quantities, restock })
  async function call(token: string, tenant: string, command?: PendingWholesaleReturn, quote?: WholesaleReturnRequest) {
    if (!api) throw new Error('Back Office API is not configured.')
    const response = await fetch(
      `${api.replace(/\/$/, '')}${quote ? '/v1/wholesale/returns/preview' : command ? wholesaleReturnPath(command) : '/v1/wholesale/returns'}`,
      {
        method: command || quote ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Tenant-Id': tenant,
          ...(command ? { 'Content-Type': 'application/json', 'Idempotency-Key': command.key } : {}),
          ...(quote ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(command || quote ? { body: JSON.stringify(command?.payload ?? quote) } : {}),
      },
    )
    const result: unknown = await response.json()
    if (!response.ok)
      throw Object.assign(
        new Error((result as { error?: { message?: string } }).error?.message ?? 'Return or credit request failed.'),
        { code: (result as { error?: { code?: string } }).error?.code, commandRejected: !!command },
      )
    return result
  }
  useEffect(() => {
    let active = true
    async function initialize() {
      try {
        if (!auth || !api) throw new Error('Authentication or Back Office API is not configured.')
        const { data: session, error: sessionError } = await auth.auth.getSession()
        if (sessionError) throw sessionError
        if (!session.session) throw new Error('Sign in to view returns and credits.')
        const response = await fetch(`${api.replace(/\/$/, '')}/v1/me`, {
          headers: { Authorization: `Bearer ${session.session.access_token}` },
        })
        if (!response.ok) throw new Error('Could not verify business access.')
        const access = sessionContextResponseSchema.parse(await response.json()),
          tenant = selectActiveTenant(access.tenants)
        if (!tenant) throw new Error('Select an authorized business first.')
        const storage = `hcs-aw4:${session.session.user.id}:${tenant.tenantId}`
        const restored = restoreWholesaleReturn(sessionStorage.getItem(storage))
        if (active) {
          setScope({ user: session.session.user.id, tenant: tenant.tenantId, storage })
          setPending(restored)
          if (restored) setMode(restored.operation)
        }
        const next = wholesaleReturnsContextSchema.parse(await call(session.session.access_token, tenant.tenantId))
        if (active) setData(next)
      } catch (cause) {
        if (active) {
          setData(null)
          setError(cause instanceof Error ? cause.message : 'Could not load returns.')
        }
      } finally {
        if (active) setBusy(false)
      }
    }
    void initialize()
    return () => {
      active = false
    }
  }, [auth])
  const selectedInvoice = data?.invoices.find((row) => row.invoiceId === invoice)
  const selectedNote = data?.notes.find((row) => row.creditNoteId === note)
  const selectedMethod = data?.methods.find((row) => row.id === method)
  const canAct = mode === 'return' ? data?.canPost : mode === 'apply' ? data?.canApply : data?.canRefund
  function returnPayload(): WholesaleReturnRequest {
    return wholesaleReturnRequestSchema.parse({
      invoiceId: invoice,
      reason,
      lines: (selectedInvoice?.lines ?? [])
        .filter((line) => quantities[line.invoiceLineId] && quantities[line.invoiceLineId] !== '0')
        .map((line) => {
          const text = quantities[line.invoiceLineId] ?? ''
          if (!/^[1-9][0-9]*$/.test(text)) throw new Error('Enter positive whole-unit quantities.')
          const milli = BigInt(text) * 1000n
          if (milli > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Quantity is too large.')
          return {
            invoiceLineId: line.invoiceLineId,
            quantityMilli: Number(milli),
            returnToStock: restock[line.invoiceLineId] ?? true,
          }
        }),
    })
  }
  async function loadPreview() {
    if (!auth || !scope || !data?.canPost || pending || lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      const payload = returnPayload(),
        { data: session, error: sessionError } = await auth.auth.getSession()
      if (sessionError) throw sessionError
      if (!session.session || session.session.user.id !== scope.user)
        throw new Error('Sign in to the original account.')
      const result = wholesaleReturnPreviewSchema.parse(
        await call(session.session.access_token, scope.tenant, undefined, payload),
      )
      setPreview({ signature: previewSignature, result })
    } catch (cause) {
      setPreview(null)
      setError(cause instanceof Error ? cause.message : 'Preview unavailable.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!auth || !scope || !data || lock.current || !canAct) return
    lock.current = true
    setBusy(true)
    setError(null)
    setMessage(null)
    setCanDismiss(false)
    try {
      const { data: session, error: sessionError } = await auth.auth.getSession()
      if (sessionError) throw sessionError
      if (!session.session || session.session.user.id !== scope.user)
        throw new Error('Sign in to the original account to reconcile this command.')
      let command = pending
      if (!command) {
        if (mode === 'return' && preview?.signature !== previewSignature)
          throw new Error('Preview the current return before posting.')
        const payload =
          mode === 'return'
            ? returnPayload()
            : mode === 'apply'
              ? { creditNoteId: note, invoiceId: invoice, amountMinor: parsePaymentMoney(amount), reason }
              : {
                  creditNoteId: note,
                  paymentMethodId: method,
                  registerSessionId: selectedMethod?.type === 'cash' ? register : null,
                  referenceLastFour: selectedMethod?.type === 'cash' ? null : reference,
                  payoutConfirmed: confirmed,
                  amountMinor: parsePaymentMoney(amount),
                  reason,
                }
        command = pendingWholesaleReturnSchema.parse({ operation: mode, key: crypto.randomUUID(), payload })
        sessionStorage.setItem(scope.storage, JSON.stringify(command))
        setPending(command)
      }
      const result = await call(session.session.access_token, scope.tenant, command)
      const history = wholesaleReturnsContextSchema.parse(await call(session.session.access_token, scope.tenant))
      reconcileWholesaleReturn(command, result, history)
      sessionStorage.removeItem(scope.storage)
      setPending(null)
      setData(history)
      setConfirmed(false)
      setQuantities({})
      setPreview(null)
      setMessage(
        command.operation === 'return'
          ? 'Credit note posted.'
          : command.operation === 'apply'
            ? 'Customer credit applied.'
            : 'Confirmed payout recorded.',
      )
    } catch (cause) {
      const rejection = cause as { code?: string; commandRejected?: boolean }
      setCanDismiss(!!rejection.commandRejected && /^WHOLESALE_RETURN_HCWR[1345]$/.test(rejection.code ?? ''))
      setError(cause instanceof Error ? cause.message : 'Outcome unknown. Retry the original command.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  function exportPayouts() {
    if (!data) return
    const rows = [
      ['Payout ID', 'Credit note', 'Method', 'Amount PHP', 'Reference last four'],
      ...data.payouts.map((row) => [
        row.payoutId,
        row.creditNoteId,
        data.methods.find((m) => m.id === row.paymentMethodId)?.name ?? row.paymentMethodId,
        paymentMoneyInput(row.amountMinor),
        row.referenceLastFour ?? '',
      ]),
    ]
    const csv = rows
      .map((row) =>
        row
          .map((value) => `"${(/^[=+\-@\t\r\n]/.test(value.trimStart()) ? "'" : '') + value.replaceAll('"', '""')}"`)
          .join(','),
      )
      .join('\r\n')
    const download = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })),
      anchor = document.createElement('a')
    anchor.href = download
    anchor.download = 'wholesale-credit-payouts.csv'
    anchor.click()
    URL.revokeObjectURL(download)
  }
  return (
    <div className="min-w-0 space-y-5 p-4 md:p-6">
      <Link href="/wholesale" className="inline-flex items-center gap-2">
        <ArrowLeft size={18} />
        Wholesale
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
      {busy && <p role="status">Loading...</p>}
      {data && (
        <>
          <div
            role="tablist"
            aria-label="Returns and credit actions"
            className="flex flex-wrap gap-2 border-b border-ink-900/15 pb-3"
          >
            {(['return', 'apply', 'refund'] as const).map((value) => (
              <button
                type="button"
                role="tab"
                aria-selected={mode === value}
                disabled={!!pending || busy}
                key={value}
                onClick={() => {
                  setMode(value)
                  setInvoice('')
                }}
                className={`rounded px-4 py-2 ${mode === value ? 'bg-ink-900 text-white' : 'bg-white'}`}
              >
                {value === 'return' ? 'Returns' : value === 'apply' ? 'Apply credit' : 'Refunds'}
              </button>
            ))}
          </div>
          {pending && (
            <p role="status" className="break-all border-l-2 border-amber-500 bg-amber-50 p-3">
              Pending {pending.operation}: {pending.key}
            </p>
          )}
          {pending && canDismiss && (
            <button
              type="button"
              disabled={busy}
              className="rounded border px-3 py-2"
              onClick={() => {
                if (!scope) return
                try {
                  sessionStorage.removeItem(scope.storage)
                  setPending(null)
                  setCanDismiss(false)
                  setError(null)
                } catch {
                  setError('Could not clear the rejected request from this browser.')
                }
              }}
            >
              Dismiss rejected request
            </button>
          )}
          <form onSubmit={(event) => void submit(event)} className="max-w-4xl space-y-4">
            <fieldset disabled={busy || !!pending || !canAct} className="min-w-0 space-y-4 disabled:opacity-60">
              {mode !== 'return' && (
                <label className="block space-y-1">
                  <span>Customer credit</span>
                  <select
                    className={field}
                    value={note}
                    onChange={(event) => {
                      setNote(event.target.value)
                      setInvoice('')
                    }}
                    required
                  >
                    <option value="">Select credit note</option>
                    {data.notes
                      .filter((row) => row.availableCreditMinor > 0 && (mode !== 'refund' || !row.payoutBlocked))
                      .map((row) => (
                        <option key={row.creditNoteId} value={row.creditNoteId}>
                          {data.invoices.find((i) => i.invoiceId === row.invoiceId)?.invoiceNumber ?? row.invoiceId} /{' '}
                          {formatPeso(row.availableCreditMinor)}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {mode !== 'refund' && (
                <label className="block space-y-1">
                  <span>Invoice</span>
                  <select
                    className={field}
                    value={invoice}
                    onChange={(event) => {
                      setInvoice(event.target.value)
                      setQuantities({})
                    }}
                    required
                  >
                    <option value="">Select invoice</option>
                    {data.invoices
                      .filter((row) =>
                        mode === 'return'
                          ? row.valuationSupported
                          : row.customerId === selectedNote?.customerId &&
                            row.locationId === selectedNote?.locationId &&
                            (row.openDebtMinor ?? 0) > 0,
                      )
                      .map((row) => (
                        <option key={row.invoiceId} value={row.invoiceId}>
                          {row.invoiceNumber} / {row.customerName} / {row.locationName}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {mode === 'return' && selectedInvoice && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="py-3">Item</th>
                        <th>Remaining</th>
                        <th>Unit price</th>
                        <th>Return quantity</th>
                        <th>Restock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedInvoice.lines.map((line) => (
                        <tr key={line.invoiceLineId} className="border-b">
                          <td className="min-w-40 py-3">{line.name}</td>
                          <td>{(line.quantityMilli - line.returnedQuantityMilli) / 1000}</td>
                          <td>{formatPeso(line.unitPriceMinor)}</td>
                          <td>
                            <input
                              aria-label={`Return quantity ${line.name}`}
                              type="number"
                              min="0"
                              step="1"
                              max={(line.quantityMilli - line.returnedQuantityMilli) / 1000}
                              className="w-24 rounded border p-2"
                              value={quantities[line.invoiceLineId] ?? ''}
                              onChange={(event) =>
                                setQuantities({ ...quantities, [line.invoiceLineId]: event.target.value })
                              }
                            />
                          </td>
                          <td>
                            <input
                              aria-label={`Restock ${line.name}`}
                              type="checkbox"
                              checked={restock[line.invoiceLineId] ?? true}
                              onChange={(event) =>
                                setRestock({ ...restock, [line.invoiceLineId]: event.target.checked })
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {mode !== 'return' && (
                <label className="block space-y-1">
                  <span>Amount PHP</span>
                  <input
                    className={field}
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    required
                  />
                </label>
              )}
              {mode === 'refund' && (
                <>
                  <label className="block space-y-1">
                    <span>Original payment method</span>
                    <select
                      className={field}
                      value={method}
                      onChange={(event) => {
                        setMethod(event.target.value)
                        setRegister('')
                        setReference('')
                      }}
                      required
                    >
                      <option value="">Select method</option>
                      {data.methods.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedMethod?.type === 'cash' ? (
                    <label className="block space-y-1">
                      <span>Open register</span>
                      <select
                        className={field}
                        value={register}
                        onChange={(event) => setRegister(event.target.value)}
                        required
                      >
                        <option value="">Select register session</option>
                        {data.sessions
                          .filter((row) => row.locationId === selectedNote?.locationId)
                          .map((row) => (
                            <option key={row.id} value={row.id}>
                              {row.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  ) : (
                    <label className="block space-y-1">
                      <span>Transaction reference last four digits</span>
                      <input
                        className={field}
                        inputMode="numeric"
                        pattern="[0-9]{4}"
                        maxLength={4}
                        value={reference}
                        onChange={(event) => setReference(event.target.value)}
                        required
                      />
                    </label>
                  )}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      required
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    Payout completed and verified
                  </label>
                </>
              )}
              <label className="block space-y-1">
                <span>Reason</span>
                <textarea
                  className={field}
                  minLength={3}
                  maxLength={240}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                />
              </label>
            </fieldset>
            {mode === 'return' && !pending && (
              <button
                type="button"
                disabled={busy || !canAct}
                onClick={() => void loadPreview()}
                className="mr-3 inline-flex items-center gap-2 rounded border px-4 py-3 disabled:opacity-50"
              >
                <Calculator size={18} />
                Preview
              </button>
            )}
            {mode === 'return' && preview?.signature === previewSignature && (
              <dl className="grid gap-3 border-y border-ink-900/15 py-4 sm:grid-cols-3">
                <div>
                  <dt>Credit note</dt>
                  <dd className="font-semibold">{formatPeso(preview.result.totalCreditMinor)}</dd>
                </div>
                <div>
                  <dt>Debt reduction</dt>
                  <dd>{formatPeso(preview.result.debtReductionMinor)}</dd>
                </div>
                <div>
                  <dt>New customer credit</dt>
                  <dd>{formatPeso(preview.result.newCustomerCreditMinor)}</dd>
                </div>
              </dl>
            )}
            <button
              disabled={busy || !canAct || (mode === 'return' && !pending && preview?.signature !== previewSignature)}
              className="inline-flex items-center gap-2 rounded bg-ink-900 px-4 py-3 text-white disabled:opacity-50"
            >
              {pending ? <RotateCcw size={18} /> : <Check size={18} />}{' '}
              {pending
                ? 'Retry original request'
                : mode === 'return'
                  ? 'Post credit note'
                  : mode === 'apply'
                    ? 'Apply credit'
                    : 'Record confirmed payout'}
            </button>
          </form>
          <section className="space-y-3 border-t border-ink-900/15 pt-5">
            <h2 className="text-lg font-semibold">Credit notes</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="py-3">Invoice</th>
                    <th>Return</th>
                    <th>Credit issued</th>
                    <th>Credit available</th>
                  </tr>
                </thead>
                <tbody>
                  {data.notes.map((row) => (
                    <tr key={row.creditNoteId} className="border-t">
                      <td className="py-3">
                        {data.invoices.find((i) => i.invoiceId === row.invoiceId)?.invoiceNumber ?? row.invoiceId}
                      </td>
                      <td>{formatPeso(row.amountMinor)}</td>
                      <td>{formatPeso(row.issuedCreditMinor)}</td>
                      <td>{formatPeso(row.availableCreditMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.notes.length && <p className="py-4 text-ink-900/60">No credit notes</p>}
            </div>
          </section>
          <section className="space-y-3 border-t border-ink-900/15 pt-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Recorded payouts</h2>
              <button
                type="button"
                onClick={exportPayouts}
                disabled={!data.payouts.length}
                className="inline-flex items-center gap-2 rounded border px-3 py-2 disabled:opacity-50"
              >
                <Download size={18} />
                CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="py-3">Credit note</th>
                    <th>Method</th>
                    <th>Amount</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payouts.map((row) => (
                    <tr key={row.payoutId} className="border-t">
                      <td className="max-w-64 break-all py-3">{row.creditNoteId}</td>
                      <td>{data.methods.find((m) => m.id === row.paymentMethodId)?.name ?? row.paymentMethodId}</td>
                      <td>{formatPeso(row.amountMinor)}</td>
                      <td>{row.referenceLastFour ?? 'Cash'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.payouts.length && <p className="py-4 text-ink-900/60">No recorded payouts</p>}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
