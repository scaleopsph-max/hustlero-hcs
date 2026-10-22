'use client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Undo2 } from 'lucide-react'
import { wholesaleFundReversalRequestSchema, type WholesaleFundsContext } from '@hcs/contracts'
import { formatPeso } from '@hcs/ui'
import {
  restoreFundReversal,
  reconcileFundReversal,
  fundReversalDefinitivelyRejected,
  type PendingFundReversal,
} from '@/lib/wholesale-fund-reversal'

type Props = {
  storage: string
  data: WholesaleFundsContext
  execute: (command: PendingFundReversal) => Promise<{ result: unknown; history: WholesaleFundsContext }>
}
export function WholesaleFundReversalForm({ storage, data, execute }: Props) {
  const [pending, setPending] = useState<PendingFundReversal | null>(null)
  const [payment, setPayment] = useState(''),
    [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null)
  const locked = useRef(false)
  const [canDismiss, setCanDismiss] = useState(false)
  const selected = data.payments.find((row) => row.paymentId === (pending?.payload.paymentId ?? payment))
  useEffect(() => {
    try {
      setPending(restoreFundReversal(sessionStorage.getItem(storage)))
    } catch {
      setError('Pending reversal could not be read. Original command must be reconciled.')
      locked.current = true
    }
  }, [storage])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (locked.current || !data.canReverse) return
    locked.current = true
    setBusy(true)
    setError(null)
    setMessage(null)
    setCanDismiss(false)
    try {
      const command = pending ?? {
        key: crypto.randomUUID(),
        payload: wholesaleFundReversalRequestSchema.parse({ paymentId: payment, reason, reversalConfirmed: confirmed }),
      }
      sessionStorage.setItem(storage, JSON.stringify(command))
      setPending(command)
      const { result, history } = await execute(command)
      reconcileFundReversal(command, result, history)
      sessionStorage.removeItem(storage)
      setPending(null)
      setConfirmed(false)
      setMessage('Original fund allocation reversed. No customer payout recorded.')
    } catch (cause) {
      setCanDismiss(fundReversalDefinitivelyRejected((cause as { code?: unknown })?.code))
      setError(cause instanceof Error ? cause.message : 'Reversal failed. Retry the original command.')
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="max-w-3xl space-y-4 border-t border-ink-900/15 pt-5">
      <h2 className="text-xl font-semibold">Reverse fund allocation</h2>
      {error && (
        <p role="alert" className="border-l-2 border-red-500 bg-red-50 p-3">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {pending && <p role="status">Pending reversal: {pending.payload.paymentId}</p>}
      {pending && canDismiss && (
        <button
          type="button"
          disabled={busy}
          className="rounded border border-ink-900/20 px-3 py-2"
          onClick={() => {
            sessionStorage.removeItem(storage)
            setPending(null)
            setCanDismiss(false)
            setError(null)
            setPayment('')
            setConfirmed(false)
          }}
        >
          Dismiss rejected reversal
        </button>
      )}
      <fieldset disabled={busy || !!pending || !data.canReverse} className="min-w-0 space-y-3 disabled:opacity-60">
        <label className="block space-y-1">
          <span>Original allocated receipt</span>
          <select
            className="w-full min-w-0 rounded border border-ink-900/20 bg-white px-3 py-2"
            value={payment}
            onChange={(event) => setPayment(event.target.value)}
            required
          >
            <option value="">Select allocation</option>
            {data.payments
              .filter((row) => row.allocation && !row.reversal)
              .map((row) => (
                <option key={row.paymentId} value={row.paymentId}>
                  {row.reference} / {formatPeso(row.amountMinor)}
                </option>
              ))}
          </select>
        </label>
        {selected?.allocation && (
          <dl className="grid gap-3 border-y border-ink-900/15 py-3 sm:grid-cols-2">
            <div>
              <dt>Capital / COGS debit</dt>
              <dd>{formatPeso(selected.allocation.capitalMinor)}</dd>
            </div>
            <div>
              <dt>Operating debit</dt>
              <dd>{formatPeso(selected.allocation.operatingMinor)}</dd>
            </div>
          </dl>
        )}
        <label className="block space-y-1">
          <span>Reversal reason</span>
          <input
            className="w-full rounded border border-ink-900/20 bg-white px-3 py-2"
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
          <span>Reverse the full original Capital / Operating allocation.</span>
        </label>
      </fieldset>
      <button
        disabled={busy || !data.canReverse}
        className="inline-flex items-center gap-2 rounded border border-ink-900/20 px-4 py-2 disabled:opacity-50"
      >
        <Undo2 size={18} />
        {pending ? 'Retry original reversal' : 'Reverse allocation'}
      </button>
    </form>
  )
}
