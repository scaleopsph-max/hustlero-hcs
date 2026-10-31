'use client'

import { Button, Glass, formatPeso, parsePeso } from '@hcs/ui'
import { Truck } from 'lucide-react'
import { useState, type FormEvent } from 'react'

const amountPattern = /^\d[\d,]*(\.\d{0,2})?$/

/** The delivery fee resellers pay, and the order amount that ships free. Pickup is always free. */
export function ShippingSettingsCard({
  feeMinor,
  freeAboveMinor,
  busy,
  onSave,
}: {
  feeMinor: number
  freeAboveMinor: number | null
  busy: boolean
  onSave: (body: { feeMinor: number; freeAboveMinor: number | null }) => Promise<boolean>
}) {
  const savedFee = (feeMinor / 100).toFixed(2)
  const savedFree = freeAboveMinor === null ? '' : (freeAboveMinor / 100).toFixed(2)
  const [fee, setFee] = useState(savedFee)
  const [free, setFree] = useState(savedFree)
  const [problem, setProblem] = useState<string | null>(null)
  const changed = fee.trim() !== savedFee || free.trim() !== savedFree

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!amountPattern.test(fee.trim())) return setProblem('Enter the delivery fee, e.g. 150.00 (0 for free delivery).')
    if (free.trim() && (!amountPattern.test(free.trim()) || parsePeso(free) < 1))
      return setProblem('Enter the order amount that ships free, or leave it blank.')
    setProblem(null)
    await onSave({ feeMinor: parsePeso(fee), freeAboveMinor: free.trim() ? parsePeso(free) : null })
  }

  return (
    <Glass variant="data" className="flex flex-col gap-4 rounded-panel p-5">
      <div className="flex items-start gap-3">
        <Truck size={20} className="mt-0.5 flex-none text-gold-700" />
        <div>
          <h3 className="font-semibold">Shipping fee</h3>
          <p className="text-sm text-ink-500">
            Added to delivery orders and billed on the first invoice. Resellers see it in their cart before ordering.
            Pickup is free.
          </p>
        </div>
      </div>
      <form className="grid gap-3 sm:grid-cols-[1fr,1fr,auto] sm:items-end" onSubmit={submit}>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Delivery fee (₱)
          <input
            className="min-h-10 rounded-control border border-ink-900/15 bg-white px-3 text-sm"
            inputMode="decimal"
            value={fee}
            onChange={(event) => setFee(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Free from (₱, optional)
          <input
            className="min-h-10 rounded-control border border-ink-900/15 bg-white px-3 text-sm"
            inputMode="decimal"
            placeholder="No free shipping"
            value={free}
            onChange={(event) => setFree(event.target.value)}
          />
        </label>
        {changed ? (
          <Button type="submit" variant="confirm" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        ) : null}
      </form>
      {problem ? <p className="text-sm text-signal-light-critical-fg">{problem}</p> : null}
      {!changed && feeMinor > 0 ? (
        <p className="text-sm text-ink-500">
          Delivery costs {formatPeso(feeMinor)}
          {freeAboveMinor !== null ? `, free from ${formatPeso(freeAboveMinor)} in items.` : '.'}
        </p>
      ) : null}
    </Glass>
  )
}
