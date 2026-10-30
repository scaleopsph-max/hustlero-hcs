'use client'

import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { cn } from '../lib/cn'

export type ToastTone = 'success' | 'error' | 'info'
type ToastItem = { id: number; tone: ToastTone; text: string }

export interface Toaster {
  success: (text: string) => void
  error: (text: string) => void
  info: (text: string) => void
}

const noop: Toaster = { success: () => undefined, error: () => undefined, info: () => undefined }
const ToastContext = createContext<Toaster>(noop)

/** Confirmations last 4.5 s; errors stay 8 s so they can be read. Both can be closed. */
const DURATION: Record<ToastTone, number> = { success: 4500, info: 4500, error: 8000 }
const MAX_VISIBLE = 3

const icon = { success: CircleCheck, error: CircleAlert, info: Info } as const
const iconClass = {
  success: 'text-signal-dark-success-fg',
  error: 'text-signal-dark-critical-fg',
  info: 'text-signal-dark-info-fg',
} as const

/**
 * App-wide confirmations and errors. Toasts appear at the top on phones (clear of bottom
 * navigation) and bottom-right on wider screens, are announced to screen readers, and never
 * block the page.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const next = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id))
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
  }, [])

  const push = useCallback(
    (tone: ToastTone, text: string) => {
      if (!text.trim()) return
      const id = next.current++
      setItems((current) => [...current.filter((item) => item.text !== text), { id, tone, text }].slice(-MAX_VISIBLE))
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DURATION[tone]),
      )
    },
    [dismiss],
  )

  useEffect(() => {
    const active = timers.current
    return () => active.forEach((timer) => clearTimeout(timer))
  }, [])

  const toaster = useMemo<Toaster>(
    () => ({
      success: (text) => push('success', text),
      error: (text) => push('error', text),
      info: (text) => push('info', text),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={toaster}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top),12px)] z-[70] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:left-auto sm:right-6 sm:top-auto sm:items-end sm:px-0"
      >
        {items.map((item) => {
          const Icon = icon[item.tone]
          return (
            <div
              key={item.id}
              role={item.tone === 'error' ? 'alert' : 'status'}
              className={cn(
                'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-control border px-4 py-3 text-sm text-white shadow-[0_12px_32px_rgba(0,0,0,0.28)] motion-safe:animate-[toast-in_180ms_ease-out]',
                item.tone === 'error' ? 'border-[#C93B33]/60 bg-ink-900' : 'border-white/10 bg-ink-900',
              )}
            >
              <Icon size={18} className={cn('mt-0.5 flex-none', iconClass[item.tone])} aria-hidden />
              <p className="min-w-0 flex-1 leading-5">{item.text}</p>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => dismiss(item.id)}
                className="-mr-1 flex size-6 flex-none items-center justify-center rounded-full text-ink-300 hover:bg-white/10 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

/** `toast.success('Saved.')`, `toast.error(message)`. Does nothing outside a ToastProvider. */
export function useToast(): Toaster {
  return useContext(ToastContext)
}
