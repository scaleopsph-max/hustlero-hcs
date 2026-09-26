'use client'

import { ChevronDown, Lock } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Glass, Logo, cn } from '@hcs/ui'
import { NAV_CONTEXT, navGroups, resolveNav } from '@/mock/nav'

/** Floating black-glass sidebar. Adaptive: see mock/nav.ts. */
export function Sidebar({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const pathname = usePathname()
  const groups = resolveNav(navGroups, NAV_CONTEXT)
  const lockedCount = groups.flatMap((g) => g.items).filter((i) => i.locked).length

  return (
    <Glass
      variant="dark"
      as="aside"
      className={cn('flex w-[248px] flex-none flex-col gap-4 rounded-[24px] px-3.5 py-5 text-ink-200', className)}
    >
      <div className="flex h-11 items-center gap-3 px-1.5">
        <Logo size={36} />
        <span className="font-display text-[19px] font-bold text-white">HUSTLERO</span>
      </div>

      <button
        type="button"
        className="flex h-14 items-center justify-between gap-2 rounded-[14px] border border-white/[0.12] bg-white/[0.08] px-3.5 text-left text-white"
      >
        <span className="flex flex-col">
          <span className="text-sm font-semibold">Mabuhay Trading</span>
          <span className="text-xs text-ink-300">3 locations</span>
        </span>
        <ChevronDown size={18} strokeWidth={1.75} className="text-ink-300" />
      </button>

      <nav aria-label="Main" className="flex flex-col">
        {groups.map((g) => (
          <div key={g.heading} className="flex flex-col">
            <div className="px-3 pb-1.5 pt-[18px] text-xs font-semibold text-ink-400">{g.heading}</div>
            {g.items.map(({ label, href, icon: Icon, badge, locked }) => {
              const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
              return (
                <Link
                  key={href}
                  href={href}
                  {...(onNavigate ? { onClick: onNavigate } : {})}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-10 items-center gap-3 rounded-control px-3 text-sm font-medium',
                    active
                      ? 'bg-gold-500/[0.16] text-gold-100'
                      : locked
                        ? 'text-ink-400'
                        : 'text-ink-200 hover:bg-white/[0.06]',
                  )}
                >
                  <Icon size={20} strokeWidth={1.75} className="flex-none" />
                  <span className="flex-1">{label}</span>
                  {badge ? (
                    <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-gold-500 px-[7px] text-xs font-bold text-ink-950">
                      {badge}
                    </span>
                  ) : null}
                  {locked ? <Lock size={16} strokeWidth={1.75} aria-label="Locked module" /> : null}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-1 rounded-[16px] border border-white/10 bg-white/[0.06] p-3.5">
        <span className="text-sm font-semibold text-white">Free core plan</span>
        <span className="text-[13px] leading-[18px] text-ink-300">
          {lockedCount} module{lockedCount === 1 ? ' is' : 's are'} locked. Unlock them any time.
        </span>
        <Link href="/settings" className="mt-1.5 text-[13px] font-semibold text-gold-300">
          See modules
        </Link>
      </div>
    </Glass>
  )
}
