import { cn } from '@hcs/ui'

export type SyncStatus = 'online' | 'syncing' | 'offline'

const config: Record<SyncStatus, { dot: string; label: (pending: number) => string }> = {
  online: { dot: 'bg-signal-dark-success-fg', label: () => 'Online, synced' },
  syncing: { dot: 'bg-signal-dark-info-fg animate-pulse', label: (n) => `Syncing ${n} sale${n === 1 ? '' : 's'}` },
  offline: { dot: 'bg-signal-dark-attention-fg', label: () => 'Offline, sales saved on this device' },
}

/** Spec section 27.6: offline and sync state must always stay visible. Render this on every POS screen. */
export function SyncPill({ status = 'online', pending = 0 }: { status?: SyncStatus; pending?: number }) {
  const c = config[status]
  return (
    <span
      role="status"
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-3.5 text-[13px] font-semibold text-white',
      )}
    >
      <span className={cn('size-2.5 rounded-full', c.dot)} />
      {c.label(pending)}
    </span>
  )
}
