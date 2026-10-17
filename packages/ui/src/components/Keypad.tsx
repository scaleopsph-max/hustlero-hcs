'use client'

import { Delete } from 'lucide-react'
import { cn } from '../lib/cn'

/** '0'-'9', '.', 'clear' or 'back'. */
export type KeypadKey = string

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

/**
 * 3x4 touch keypad. mode "pin": bottom row is Clear, 0, Backspace. mode "amount": ".", 0, Backspace.
 * Keys are 64px tall (touch-xl). Used by PIN sign-in, checkout and manager PIN.
 */
export function Keypad({
  onKey,
  mode = 'pin',
  className,
}: {
  onKey: (key: KeypadKey) => void
  mode?: 'pin' | 'amount'
  className?: string
}) {
  const keyClass =
    'flex min-h-touch-xl items-center justify-center rounded-[18px] border border-white/20 bg-white/[0.08] font-display text-[26px] font-semibold text-white hover:bg-white/[0.14] active:bg-white/20'
  return (
    <div className={cn('grid grid-cols-3 gap-3', className)}>
      {DIGITS.map((d) => (
        <button key={d} type="button" onClick={() => onKey(d)} className={keyClass}>
          {d}
        </button>
      ))}
      {mode === 'pin' ? (
        <button
          type="button"
          aria-label="Clear PIN"
          onClick={() => onKey('clear')}
          className={cn(keyClass, 'font-sans text-[17px]')}
        >
          Clear
        </button>
      ) : (
        <button type="button" aria-label="Decimal point" onClick={() => onKey('.')} className={keyClass}>
          .
        </button>
      )}
      <button type="button" onClick={() => onKey('0')} className={keyClass}>
        0
      </button>
      <button type="button" aria-label="Delete last digit" onClick={() => onKey('back')} className={keyClass}>
        <Delete size={26} strokeWidth={1.75} />
      </button>
    </div>
  )
}
