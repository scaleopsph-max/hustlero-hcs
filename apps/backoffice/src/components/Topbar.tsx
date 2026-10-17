import { Calendar, ChevronDown, Layers, MapPin, UserRound, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Glass } from '@hcs/ui'
import { NotificationBell } from './NotificationBell'

const filters: { label: string; Icon: LucideIcon }[] = [
  { label: 'Today', Icon: Calendar },
  { label: 'All locations', Icon: MapPin },
  { label: 'All channels', Icon: Layers },
]

const ghost =
  'flex min-h-touch items-center gap-2 rounded-control border border-ink-900/[0.14] bg-white/70 px-3.5 text-sm font-medium text-ink-900'

/**
 * Page header. Global filters (date, location, channel) belong to the Dashboard (spec section 28).
 * Other pages pass their own actions instead.
 */
export function Topbar({
  title,
  subtitle,
  showFilters = false,
  actions,
}: {
  title: string
  subtitle?: string
  showFilters?: boolean
  actions?: ReactNode
}) {
  return (
    <Glass
      variant="light"
      as="header"
      className="flex min-h-16 flex-none items-center justify-between gap-3 rounded-[20px] px-4 py-2 sm:px-5"
    >
      <div className="flex min-w-0 flex-col">
        <h1 className="truncate font-display text-xl font-bold leading-7 text-ink-900 sm:text-2xl">{title}</h1>
        {subtitle ? <span className="hidden text-xs text-ink-500 sm:block">{subtitle}</span> : null}
      </div>
      <div className="flex flex-none items-center gap-2 sm:gap-2.5">
        {showFilters
          ? filters.map(({ label, Icon }) => (
              <button key={label} type="button" className={ghost}>
                <Icon size={18} strokeWidth={1.75} className="text-ink-500" />
                {label}
                <ChevronDown size={16} strokeWidth={1.75} className="text-ink-500" />
              </button>
            ))
          : null}
        {actions}
        <NotificationBell />
        <span
          role="img"
          aria-label="Account"
          title="Account"
          className="ml-0.5 flex size-10 flex-none items-center justify-center rounded-full bg-ink-900 text-gold-300 sm:ml-1.5"
        >
          <UserRound size={20} aria-hidden="true" />
        </span>
      </div>
    </Glass>
  )
}
