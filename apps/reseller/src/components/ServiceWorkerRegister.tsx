'use client'

import { useEffect } from 'react'

/** Registers the offline shell. Orders are always sent online; see public/sw.js. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => undefined)
  }, [])
  return null
}
