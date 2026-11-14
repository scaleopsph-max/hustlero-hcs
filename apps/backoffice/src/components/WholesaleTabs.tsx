'use client'

import { cn } from '@hcs/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** The sections of Advanced wholesale, in the order the work happens: sell, collect, then control. */
export const wholesaleSections = [
  { href: '/wholesale', label: 'Orders', group: 'sell' },
  { href: '/wholesale/returns', label: 'Returns and credits', group: 'sell' },
  { href: '/wholesale/payments', label: 'Payments', group: 'collect' },
  { href: '/wholesale/statements', label: 'Statements and aging', group: 'collect' },
  { href: '/wholesale/settlement', label: 'Settlement', group: 'collect' },
  { href: '/wholesale/funds', label: 'Fund allocation', group: 'collect' },
  { href: '/wholesale/credit', label: 'Terms and credit', group: 'control' },
  { href: '/wholesale/approvals', label: 'Credit approvals', group: 'control' },
] as const

/** The section a path belongs to: the longest matching section, so /wholesale/approvals/manage is Credit approvals. */
export function activeWholesaleSection(pathname: string): string {
  const path = pathname.replace(/\/$/, '') || '/'
  const match = wholesaleSections
    .filter((section) => path === section.href || path.startsWith(`${section.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]
  return match?.href ?? '/wholesale'
}

export function WholesaleTabs() {
  const active = activeWholesaleSection(usePathname() ?? '/wholesale')
  return (
    <nav aria-label="Advanced wholesale sections" className="max-w-full">
      <ul className="flex max-w-full gap-1 overflow-x-auto rounded-control border border-ink-900/15 bg-white/70 p-1">
        {wholesaleSections.map((section, index) => {
          const current = section.href === active
          const newGroup = index > 0 && wholesaleSections[index - 1]?.group !== section.group
          return (
            <li key={section.href} className="flex flex-none items-center">
              {newGroup ? <span aria-hidden="true" className="mx-1 h-5 w-px bg-ink-900/15" /> : null}
              <Link
                href={section.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'inline-flex h-9 items-center whitespace-nowrap rounded-control px-4 text-sm font-semibold',
                  current ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-ink-900/5',
                )}
              >
                {section.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
