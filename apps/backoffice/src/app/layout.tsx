import type { Metadata } from 'next'
import { Bricolage_Grotesque, Figtree } from 'next/font/google'
import type { ReactNode } from 'react'
import './globals.css'
import { AppShell } from '@/components/AppShell'

const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display', display: 'swap' })
const sans = Figtree({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })

export const metadata: Metadata = {
  title: 'HCS Back Office',
  description: 'Manage sales, stock, purchasing, finance and approvals.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="app-backoffice min-h-screen bg-ink-100 text-ink-900">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
