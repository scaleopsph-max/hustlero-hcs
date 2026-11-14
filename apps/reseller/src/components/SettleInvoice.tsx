'use client'

import type { ResellerStatement } from '@hcs/contracts'
import { Button, formatPeso, parsePeso } from '@hcs/ui'
import { useRef, useState, type FormEvent } from 'react'

import { newIdempotencyKey } from '@/lib/portal-api'

type Invoice = ResellerStatement['invoices'][number]

/** Inline form under an open invoice: pay part of it with return credit or with loyalty points. */
export function SettleInvoice({
  invoice,
  mode,
  creditAvailableMinor,
  points,
  onApplyCredit,
  onRedeemPoints,
  onDone,
}: {
  invoice: Invoice
  mode: 'credit' | 'points'
  creditAvailableMinor: number
  points: NonNullable<ResellerStatement['points']>
  onApplyCredit: (invoiceId: string, amountMinor: number, key: string) => Promise<unknown>
  onRedeemPoints: (invoiceId: string, points: number, key: string) => Promise<unknown>
  onDone: () => void
}) {
  const value = points.redeemValueMinor ?? 0
  const maxCredit = Math.min(creditAvailableMinor, invoice.balanceMinor)
  const maxPoints = value > 0 ? Math.min(points.balance, Math.floor(invoice.balanceMinor / value)) : 0
  const [text, setText] = useState(mode === 'credit' ? (maxCredit / 100).toFixed(2) : String(maxPoints))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One key per attempt so a retried tap never pays twice.
  const attempt = useRef<{ key: string; fingerprint: string } | null>(null)

  const pointsWanted = Number.parseInt(text, 10)
  const preview =
    mode === 'points' && Number.isSafeInteger(pointsWanted) && pointsWanted > 0
      ? `${pointsWanted} points = ${formatPeso(pointsWanted * value)}`
      : null

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    let amount: number
    if (mode === 'credit') {
      amount = parsePeso(text)
      if (!/^\d[\d,]*(\.\d{0,2})?$/.test(text.trim()) || amount < 1) return setError('Enter an amount, e.g. 460.00.')
      if (amount > maxCredit) return setError(`You can use up to ${formatPeso(maxCredit)} on this invoice.`)
    } else {
      amount = pointsWanted
      if (!/^\d+$/.test(text.trim()) || amount < points.minimumPoints)
        return setError(`Use at least ${points.minimumPoints} points.`)
      if (amount > maxPoints) return setError(`You can use up to ${maxPoints} points on this invoice.`)
    }
    const fingerprint = `${mode}:${invoice.invoiceId}:${amount}`
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { key: newIdempotencyKey(mode === 'credit' ? 'cr' : 'pt'), fingerprint }
    setBusy(true)
    try {
      if (mode === 'credit') await onApplyCredit(invoice.invoiceId, amount, attempt.current.key)
      else await onRedeemPoints(invoice.invoiceId, amount, attempt.current.key)
      attempt.current = null
      onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'It did not go through. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-2 rounded-control bg-white/5 p-3 text-small">
      <label className="flex flex-col gap-1">
        <span className="font-semibold">
          {mode === 'credit'
            ? `Use credit (up to ${formatPeso(maxCredit)})`
            : `Use points (you have ${points.balance}; 1 point = ${formatPeso(value)})`}
        </span>
        <input
          inputMode={mode === 'credit' ? 'decimal' : 'numeric'}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="min-h-11 rounded-control border border-white/20 bg-ink-900 px-3 text-body"
          aria-label={mode === 'credit' ? 'Credit amount' : 'Points to use'}
        />
      </label>
      {preview ? <p className="text-ink-300">{preview}</p> : null}
      {error ? (
        <p className="text-signal-dark-critical-fg" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="sm" variant="primary" disabled={busy}>
        {busy ? 'Applying…' : mode === 'credit' ? 'Apply credit' : 'Pay with points'}
      </Button>
    </form>
  )
}
