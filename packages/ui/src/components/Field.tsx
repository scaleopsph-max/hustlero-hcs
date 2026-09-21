'use client'

import { useId, type InputHTMLAttributes } from 'react'
import { cn } from '../lib/cn'

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string
  hint?: string
  /** Say what happened, why, and what to do next (spec section 26). */
  error?: string
  surface?: 'dark' | 'light'
}

export function Field({ label, hint, error, surface = 'dark', className, ...rest }: FieldProps) {
  const id = useId()
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  const dark = surface === 'dark'
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={cn('text-sm font-semibold', dark ? 'text-ink-50' : 'text-ink-900')}>
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn('field', error && 'field-error', className)}
        {...rest}
      />
      {error ? (
        <p
          id={`${id}-error`}
          className={cn(
            'text-[13px] leading-[19px]',
            dark ? 'text-signal-dark-critical-fg' : 'text-signal-light-critical-fg',
          )}
        >
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className={cn('text-[13px]', dark ? 'text-ink-300' : 'text-ink-500')}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
