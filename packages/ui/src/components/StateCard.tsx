import { Inbox, Lock, RefreshCw, ShieldAlert, TriangleAlert, WifiOff, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Glass } from './Glass'

/**
 * Standard UI states from spec section 26. Every blocked state answers four questions:
 * what happened, why, whether the action went through, and what to do next.
 * Not covered here: LOADING (use skeletons), SUCCESS (toast), ERROR (use Field error or a Warning card),
 * ARCHIVED/INACTIVE (row-level chip).
 */
export type StateKind = 'locked' | 'restricted' | 'offline' | 'syncing' | 'partial' | 'empty'

const config: Record<StateKind, { label: string; Icon: LucideIcon; tone: string }> = {
  locked: { label: 'Locked feature', Icon: Lock, tone: 'bg-white/10 text-ink-200' },
  restricted: { label: 'Restricted', Icon: ShieldAlert, tone: 'bg-signal-dark-warning-bg text-signal-dark-warning-fg' },
  offline: { label: 'Offline', Icon: WifiOff, tone: 'bg-signal-dark-attention-bg text-signal-dark-attention-fg' },
  syncing: { label: 'Syncing', Icon: RefreshCw, tone: 'bg-signal-dark-info-bg text-signal-dark-info-fg' },
  partial: {
    label: 'Partial failure',
    Icon: TriangleAlert,
    tone: 'bg-signal-dark-attention-bg text-signal-dark-attention-fg',
  },
  empty: { label: 'Empty', Icon: Inbox, tone: 'bg-signal-dark-success-bg text-signal-dark-success-fg' },
}

export function StateCard({
  kind,
  title,
  why,
  action,
  className,
}: {
  kind: StateKind
  /** What happened. */
  title: string
  /** Why it happened, and whether the action succeeded. */
  why: string
  /** What the user can do next. Pass a <Button>. */
  action?: ReactNode
  className?: string
}) {
  const { label, Icon, tone } = config[kind]
  return (
    <Glass className={cn('flex flex-col gap-3.5 rounded-glass p-5', className)}>
      <div className="flex items-center gap-3">
        <span className={cn('flex size-10 items-center justify-center rounded-full', tone)}>
          <Icon size={22} strokeWidth={1.75} />
        </span>
        <span className="text-[13px] font-semibold text-ink-300">{label}</span>
      </div>
      <h3 className="font-sans text-[17px] font-bold leading-6 text-white">{title}</h3>
      <p className="text-sm leading-[22px] text-ink-200">{why}</p>
      {action ? <div className="mt-1 self-start">{action}</div> : null}
    </Glass>
  )
}
