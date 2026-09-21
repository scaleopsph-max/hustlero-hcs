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
    <Glass as="header" className="flex h-16 flex-none items-center justify-between rounded-[20px] px-4">
      <div className="flex items-center gap-5">
        <Link
          href={backHref}
          className="flex min-h-touch items-center gap-2 rounded-control border border-white/20 px-3.5 text-sm font-semibold text-white"
        >
          <ArrowLeft size={18} strokeWidth={1.9} />
          {backLabel}
        </Link>
        <div className="flex flex-col">
          <h1 className="font-display text-[22px] font-bold leading-6 text-white">{title}</h1>
          {subtitle ? <span className="text-[13px] text-ink-300">{subtitle}</span> : null}
        </div>
      </div>
      <div className="flex items-center gap-3.5">
        {right}
        <SyncPill status="online" />
      </div>
    </Glass>
  )
}
