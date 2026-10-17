'use client'

import { Menu, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Logo, Surface } from '@hcs/ui'
import { Sidebar } from './Sidebar'

/** Back Office shell: light surface with gold and gray glows, black glass sidebar, content column. */
export function AppShell({ children }: { children: ReactNode }) {
  const isSetup = usePathname() === '/setup'
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  if (isSetup) {
    return <main className="min-h-screen bg-ink-100 text-ink-900">{children}</main>
  }

  return (
    <Surface
      tone="light"
      className="flex min-h-screen flex-col gap-3 p-3 lg:flex-row lg:gap-4 lg:p-4"
      glows={[
        { color: 'gold', className: '-right-32 -top-36 size-[620px] opacity-40' },
        { color: 'gold', className: 'left-[420px] top-[900px] size-[560px] opacity-25' },
        { color: 'gray', className: 'right-24 top-[1000px] size-[520px] opacity-30' },
      ]}
    >
      <div className="flex h-14 items-center justify-between rounded-panel border border-ink-900/10 bg-white/80 px-4 lg:hidden">
        <div className="flex items-center gap-2.5">
          <Logo size={32} />
          <span className="font-display text-lg font-bold">HUSTLERO</span>
        </div>
        <button
          type="button"
          aria-label="Open navigation"
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen(true)}
          className="grid size-11 place-items-center border border-ink-900/15 bg-white"
        >
          <Menu size={21} />
        </button>
      </div>
      <Sidebar className="hidden lg:flex" />
      {mobileNavOpen ? (
        <div
          className="fixed inset-0 z-50 bg-black/45 p-3 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="relative h-full w-[min(294px,calc(100vw-24px))]">
            <Sidebar className="h-full w-full overflow-y-auto" onNavigate={() => setMobileNavOpen(false)} />
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setMobileNavOpen(false)}
              className="absolute right-3 top-3 grid size-10 place-items-center rounded-full bg-white/10 text-white"
            >
              <X size={19} />
            </button>
          </div>
        </div>
      ) : null}
      <main className="flex min-w-0 flex-1 flex-col gap-4">{children}</main>
    </Surface>
  )
}
