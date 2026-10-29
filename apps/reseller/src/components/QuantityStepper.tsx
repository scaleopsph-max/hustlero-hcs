'use client'

import { Minus, Plus } from 'lucide-react'

/** Whole-unit stepper. Values are thousandths, like every quantity in HCS. */
export function QuantityStepper({
  quantityMilli,
  onChange,
  label,
}: {
  quantityMilli: number
  onChange: (quantityMilli: number) => void
  label: string
}) {
  const units = Math.floor(quantityMilli / 1000)
  const set = (next: number) => onChange(Math.max(0, Math.min(next, 999_999)) * 1000)
  return (
    <div className="flex items-center gap-1" role="group" aria-label={`Quantity for ${label}`}>
      <button
        type="button"
        className="flex size-11 items-center justify-center rounded-control border border-white/20 bg-white/5 disabled:opacity-40"
        aria-label={`Bawasan ang ${label}`}
        disabled={units === 0}
        onClick={() => set(units - 1)}
      >
        <Minus size={18} />
      </button>
      <input
        className="h-11 w-14 rounded-control border border-white/20 bg-white/5 text-center font-semibold"
        inputMode="numeric"
        aria-label={`Quantity ng ${label}`}
        value={units === 0 ? '' : String(units)}
        placeholder="0"
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '')
          set(digits ? Number(digits) : 0)
        }}
      />
      <button
        type="button"
        className="flex size-11 items-center justify-center rounded-control bg-gold-500 text-ink-950"
        aria-label={`Dagdagan ang ${label}`}
        onClick={() => set(units + 1)}
      >
        <Plus size={18} />
      </button>
    </div>
  )
}
