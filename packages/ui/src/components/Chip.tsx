import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export type ChipTone = 'success' | 'info' | 'attention' | 'warning' | 'critical' | 'neutral'

/** Written out in full so Tailwind can see every class. Every pair passes 4.5:1 on its surface. */
const toneClass = {
  dark: {
    success: 'bg-signal-dark-success-bg text-signal-dark-success-fg',
    info: 'bg-signal-dark-info-bg text-signal-dark-info-fg',
    attention: 'bg-signal-dark-attention-bg text-signal-dark-attention-fg',
    warning: 'bg-signal-dark-warning-bg text-signal-dark-warning-fg',
    critical: 'bg-signal-dark-critical-bg text-signal-dark-critical-fg',
    neutral: 'bg-white/10 text-ink-200',
  },
  light: {
    success: 'bg-signal-light-success-bg text-signal-light-success-fg',
    info: 'bg-signal-light-info-bg text-signal-light-info-fg',
    attention: 'bg-signal-light-attention-bg text-signal-light-attention-fg',
    warning: 'bg-signal-light-warning-bg text-signal-light-warning-fg',
    critical: 'bg-signal-light-critical-bg text-signal-light-critical-fg',
    neutral: 'bg-ink-900/[0.07] text-ink-700',
  },
} as const

/** Status, alert severity, system health, stock. Map spec enums to tones in ONE place per domain (see each app mock folder). */
export function Chip({
  tone = 'neutral',
  surface = 'dark',
  className,
  children,
}: {
  tone?: ChipTone
  surface?: 'dark' | 'light'
  className?: string
  children: ReactNode
}) {
  return <span className={cn('chip', toneClass[surface][tone], className)}>{children}</span>
}
