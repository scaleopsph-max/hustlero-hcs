'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Surface } from '@hcs/ui'
import { Sidebar } from './Sidebar'

/** Back Office shell: light surface with gold and gray glows, black glass sidebar, content column. */
export function AppShell({ children }: { children: ReactNode }) {
  const isSetup = usePathname() === '/setup'

  if (isSetup) {
    return <main className="min-h-screen bg-ink-100 text-ink-900">{children}</main>
  }

  return (
    <Surface
      tone="light"
      className="flex min-h-screen gap-4 p-4"
      glows={[
        { color: 'gold', className: '-right-32 -top-36 size-[620px] opacity-40' },
        { color: 'gold', className: 'left-[420px] top-[900px] size-[560px] opacity-25' },
        { color: 'gray', className: 'right-24 top-[1000px] size-[520px] opacity-30' },
      ]}
    >
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col gap-4">{children}</main>
    </Surface>
  )
}
