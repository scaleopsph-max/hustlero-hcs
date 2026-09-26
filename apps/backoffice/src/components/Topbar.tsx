import { Bell, Calendar, ChevronDown, Layers, MapPin, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Glass } from '@hcs/ui'

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
      className="flex h-16 flex-none items-center justify-between gap-6 rounded-[20px] px-5"
    >
      <div className="flex flex-col">
        <h1 className="font-display text-2xl font-bold leading-7 text-ink-900">{title}</h1>
        {subtitle ? <span className="text-xs text-ink-500">{subtitle}</span> : null}
      </div>
      <div className="flex items-center gap-2.5">
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
        <button type="button" aria-label="Notifications" className={`${ghost} w-11 justify-center px-0`}>
          <Bell size={20} strokeWidth={1.75} />
        </button>
        <div className="ml-1.5 flex items-center gap-2.5">
          <span className="flex size-10 items-center justify-center rounded-full bg-ink-900 text-sm font-bold text-gold-300">
            AR
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Ana Reyes</span>
            <span className="text-xs text-ink-500">Owner</span>
          </div>
        </div>
      </div>
    </Glass>
  )
}
