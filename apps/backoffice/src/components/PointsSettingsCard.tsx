'use client'

import { Button, Glass, formatPeso, parsePeso } from '@hcs/ui'
import { Star } from 'lucide-react'
import { useState, type FormEvent } from 'react'

/** Whether resellers can pay invoices with loyalty points, and what a point is worth. */
export function PointsSettingsCard({
  valueMinor,
  minimumPoints,
  busy,
  onSave,
}: {
  valueMinor: number | null
  minimumPoints: number
  busy: boolean
  onSave: (body: { redeemValueMinor: number | null; minimumPoints: number }) => Promise<boolean>
}) {
  const [enabled, setEnabled] = useState(valueMinor !== null)
  const [value, setValue] = useState(valueMinor === null ? '1.00' : (valueMinor / 100).toFixed(2))
  const [minimum, setMinimum] = useState(String(minimumPoints))
  const [problem, setProblem] = useState<string | null>(null)
  const savedValue = valueMinor === null ? null : (valueMinor / 100).toFixed(2)
  const changed =
    enabled !== (valueMinor !== null) || (enabled && value !== savedValue) || minimum !== String(minimumPoints)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const pesos = parsePeso(value)
    const min = Number.parseInt(minimum, 10)
    if (enabled && (!/^\d[\d,]*(\.\d{0,2})?$/.test(value.trim()) || pesos < 1))
      return setProblem('Enter how much one point is worth, e.g. 1.00.')
    if (!/^\d+$/.test(minimum.trim()) || min < 1) return setProblem('Enter the minimum points, e.g. 10.')
    setProblem(null)
    await onSave({ redeemValueMinor: enabled ? pesos : null, minimumPoints: min })
  }

  return (
    <Glass variant="data" className="flex flex-col gap-4 rounded-panel p-5">
      <div className="flex items-start gap-3">
        <Star size={20} className="mt-0.5 flex-none text-gold-700" />
        <div>
          <h3 className="font-semibold">Pay with points</h3>
          <p className="text-sm text-ink-500">
            Resellers can use loyalty points to pay part of an open invoice from their statement. Points are earned
            under Loyalty.
          </p>
        </div>
      </div>
      <form className="grid gap-3 sm:grid-cols-[auto,1fr,1fr,auto] sm:items-end" onSubmit={submit}>
        <label className="flex min-h-10 items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Allow paying with points
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          1 point is worth (₱)
          <input
            className="min-h-10 rounded-control border border-ink-900/15 bg-white px-3 text-sm disabled:opacity-50"
            inputMode="decimal"
            disabled={!enabled}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Minimum points per use
          <input
            className="min-h-10 rounded-control border border-ink-900/15 bg-white px-3 text-sm"
            inputMode="numeric"
            value={minimum}
            onChange={(event) => setMinimum(event.target.value)}
          />
        </label>
        {changed ? (
          <Button type="submit" variant="confirm" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        ) : null}
      </form>
      {enabled && valueMinor !== null && !changed ? (
        <p className="text-sm text-ink-500">
          Now: 1 point = {formatPeso(valueMinor)}, at least {minimumPoints} points each time.
        </p>
      ) : null}
      {problem ? <p className="text-sm text-signal-light-critical-fg">{problem}</p> : null}
    </Glass>
  )
}
