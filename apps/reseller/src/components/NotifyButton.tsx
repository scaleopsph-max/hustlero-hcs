'use client'

import type { ResellerCatalogItem } from '@hcs/contracts'
import { cn } from '@hcs/ui'
import { BellPlus, BellRing } from 'lucide-react'

/** For an out-of-stock variant: ask to be told when it is back. */
export function NotifyButton({
  item,
  onNotify,
}: {
  item: ResellerCatalogItem
  onNotify: (variantId: string, notify: boolean) => void
}) {
  const on = item.notifyRequested ?? false
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onNotify(item.variantId, !on)}
      className={cn(
        'flex min-h-11 items-center justify-center gap-2 rounded-full border px-4 text-small font-semibold',
        on ? 'border-gold-500/40 bg-gold-500/15 text-gold-200' : 'border-white/20 bg-white/5 text-ink-100',
      )}
    >
      {on ? <BellRing size={16} aria-hidden /> : <BellPlus size={16} aria-hidden />}
      {on ? "We'll tell you when it's back" : 'Notify me when back in stock'}
    </button>
  )
}
