import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Glass } from '@hcs/ui'
import { SyncPill } from './SyncPill'

/** Header for Checkout and Close Register: back link, title and the sync pill. */
export function SubHeader({
  backHref,
  backLabel,
  title,
  subtitle,
  right,
}: {
  backHref: string
  backLabel: string
  title: string
  subtitle?: string
  right?: ReactNode
}) {
  return (
    <Glass
      as="header"
      className="flex min-h-16 flex-none flex-col items-stretch gap-3 rounded-[20px] p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4"
    >
      <div className="flex min-w-0 items-center gap-3 sm:gap-5">
        <Link
          href={backHref}
          className="flex min-h-touch shrink-0 items-center gap-2 rounded-control border border-white/20 px-3.5 text-sm font-semibold text-white"
        >
          <ArrowLeft size={18} strokeWidth={1.9} />
          {backLabel}
        </Link>
        <div className="flex min-w-0 flex-col break-words">
          <h1 className="font-display text-[22px] font-bold leading-6 text-white">{title}</h1>
          {subtitle ? <span className="text-[13px] text-ink-300">{subtitle}</span> : null}
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3.5 sm:justify-end">
        <div className="min-w-0 break-words">{right}</div>
        <div className="shrink-0">
          <SyncPill status="online" />
        </div>
      </div>
    </Glass>
  )
}
