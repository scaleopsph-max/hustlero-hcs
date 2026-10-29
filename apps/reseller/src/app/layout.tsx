import type { Metadata, Viewport } from 'next'
import { Bricolage_Grotesque, Figtree } from 'next/font/google'
import type { ReactNode } from 'react'
import './globals.css'

import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister'

const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display', display: 'swap' })
const sans = Figtree({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })

export const metadata: Metadata = {
  title: 'HCS Reseller Portal',
  description: 'Order at your reseller price and track every order.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Reseller', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
}

export const viewport: Viewport = {
  themeColor: '#08080A',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fil" className={`${display.variable} ${sans.variable}`}>
      <body className="app-pos min-h-dvh">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  )
}
