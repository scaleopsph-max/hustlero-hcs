'use client'

import type { ResellerNotification, ResellerNotificationKind } from '@hcs/contracts'
import { Button } from '@hcs/ui'
import {
  Award,
  BadgeCheck,
  Ban,
  Bell,
  CircleCheck,
  Clock,
  PackageCheck,
  PackagePlus,
  Store,
  Truck,
  TriangleAlert,
  Undo2,
  BellOff,
  CalendarClock,
  Share,
  Smartphone,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef } from 'react'

import { timeAgo } from '@/lib/labels'

const icons: Record<ResellerNotificationKind, { Icon: LucideIcon; tone: string }> = {
  order_confirmed: { Icon: CircleCheck, tone: 'text-signal-dark-success-fg' },
  ready_for_pickup: { Icon: Store, tone: 'text-gold-300' },
  shipped: { Icon: Truck, tone: 'text-gold-300' },
  delivered: { Icon: PackageCheck, tone: 'text-signal-dark-success-fg' },
  picked_up: { Icon: PackageCheck, tone: 'text-signal-dark-success-fg' },
  payment_verified: { Icon: BadgeCheck, tone: 'text-signal-dark-success-fg' },
  payment_rejected: { Icon: TriangleAlert, tone: 'text-signal-dark-critical-fg' },
  order_expired: { Icon: Clock, tone: 'text-signal-dark-warning-fg' },
  order_rejected: { Icon: Ban, tone: 'text-signal-dark-critical-fg' },
  return_recorded: { Icon: Undo2, tone: 'text-gold-300' },
  payment_due_soon: { Icon: CalendarClock, tone: 'text-signal-dark-attention-fg' },
  payment_overdue: { Icon: TriangleAlert, tone: 'text-signal-dark-critical-fg' },
  payment_window_closing: { Icon: Clock, tone: 'text-signal-dark-attention-fg' },
  back_in_stock: { Icon: PackagePlus, tone: 'text-signal-dark-success-fg' },
  parcel_shipped: { Icon: Truck, tone: 'text-gold-300' },
  return_request_approved: { Icon: Undo2, tone: 'text-signal-dark-success-fg' },
  return_request_declined: { Icon: Ban, tone: 'text-signal-dark-critical-fg' },
  tier_changed: { Icon: Award, tone: 'text-gold-300' },
}

/** Glass sheet with the reseller's order updates; tapping one opens that order. */
export function NotificationsSheet({
  items,
  unreadCount,
  onOpen,
  onMarkAllRead,
  onClose,
  push,
}: {
  items: ResellerNotification[]
  unreadCount: number
  onOpen: (notification: ResellerNotification) => void
  onMarkAllRead: () => void
  onClose: () => void
  push?: PushControl
}) {
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="absolute inset-0 bg-ink-950/70 backdrop-blur-md"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="notifications-title"
        className="glass-strong relative flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-sheet border-x border-t border-white/15 bg-ink-900/80 motion-safe:animate-[sheet-up_220ms_ease-out] sm:rounded-sheet sm:border-b"
      >
        <div className="mx-auto mt-2.5 h-1 w-10 flex-none rounded-full bg-white/25 sm:hidden" aria-hidden />
        <header className="flex flex-none items-center justify-between gap-3 px-5 pb-3 pt-3">
          <div>
            <h2 id="notifications-title" className="text-h4 font-semibold">
              Updates
            </h2>
            <p className="text-small text-ink-300">
              {unreadCount > 0 ? `${unreadCount} new` : 'You are all caught up'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 ? (
              <Button size="sm" onClick={onMarkAllRead}>
                Mark all read
              </Button>
            ) : null}
            <button
              ref={closeButton}
              type="button"
              onClick={onClose}
              aria-label="Close updates"
              className="flex size-11 items-center justify-center rounded-full border border-white/15 bg-white/10"
            >
              <X size={18} />
            </button>
          </div>
        </header>
        {push ? <PushCard {...push} /> : null}
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 border-t border-white/10 px-6 py-12 text-center text-ink-300">
            <Bell size={32} />
            <p>Order updates will show here: confirmations, shipping, and payments.</p>
          </div>
        ) : (
          <ul className="flex-1 overflow-y-auto overscroll-contain border-t border-white/10 px-2 pb-[max(env(safe-area-inset-bottom),12px)]">
            {items.map((item) => {
              const { Icon, tone } = icons[item.kind]
              const unread = item.readAt === null
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className="flex w-full items-start gap-3 rounded-[18px] px-3 py-3 text-left hover:bg-white/5"
                  >
                    <span
                      className={`mt-0.5 flex size-9 flex-none items-center justify-center rounded-full bg-white/10 ${tone}`}
                    >
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className={unread ? 'font-semibold' : 'text-ink-200'}>{item.title}</span>
                        {unread ? (
                          <span className="mt-1.5 size-2 flex-none rounded-full bg-gold-400" aria-label="New" />
                        ) : null}
                      </span>
                      <span className="block text-small text-ink-300">{item.message}</span>
                      <span className="block text-caption text-ink-400">{timeAgo(item.createdAt)}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Where this phone stands on push, and the actions the sheet offers. */
export type PushStatus = 'on' | 'off' | 'blocked' | 'ios-needs-install' | 'unsupported' | 'not-configured'
export type PushControl = { status: PushStatus; busy: boolean; onEnable: () => void; onDisable: () => void }

function PushCard({ status, busy, onEnable, onDisable }: PushControl) {
  if (status === 'unsupported' || status === 'not-configured') return null
  return (
    <div className="mx-5 mb-3 flex items-start gap-3 rounded-[18px] border border-white/10 bg-white/5 p-3 text-small">
      <span className="mt-0.5 flex size-8 flex-none items-center justify-center rounded-full bg-gold-500/15 text-gold-300">
        {status === 'on' ? <Bell size={16} /> : status === 'blocked' ? <BellOff size={16} /> : <Smartphone size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        {status === 'on' ? (
          <>
            <p className="font-semibold">Phone notifications are on</p>
            <p className="text-ink-300">You will get order updates even when the portal is closed.</p>
            <button type="button" disabled={busy} onClick={onDisable} className="mt-1 text-ink-300 underline">
              {busy ? 'Turning off…' : 'Turn off'}
            </button>
          </>
        ) : status === 'blocked' ? (
          <>
            <p className="font-semibold">Notifications are blocked</p>
            <p className="text-ink-300">
              Allow notifications for this site in your browser settings, then open Updates again.
            </p>
          </>
        ) : status === 'ios-needs-install' ? (
          <>
            <p className="font-semibold">Get updates on your iPhone</p>
            <p className="flex flex-wrap items-center gap-1 text-ink-300">
              Tap <Share size={14} aria-label="Share" /> Share, then Add to Home Screen. Open the portal from your Home
              Screen and turn on notifications here.
            </p>
          </>
        ) : (
          <>
            <p className="font-semibold">Get updates on your phone</p>
            <p className="text-ink-300">
              Know right away when your order is confirmed, shipped, or your payment is verified.
            </p>
            <Button size="sm" variant="primary" className="mt-2" disabled={busy} onClick={onEnable}>
              {busy ? 'Turning on…' : 'Turn on notifications'}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
