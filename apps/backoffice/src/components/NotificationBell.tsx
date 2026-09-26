'use client'

import { createClient } from '@supabase/supabase-js'
import { Bell } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { notificationCenterSchema, sessionContextResponseSchema } from '@hcs/contracts'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const apiUrl = process.env.NEXT_PUBLIC_API_URL

export function NotificationBell() {
  const [unread, setUnread] = useState(0)

  const load = useCallback(async () => {
    if (!supabaseUrl || !supabaseKey || !apiUrl) return
    const auth = createClient(supabaseUrl, supabaseKey)
    const { data } = await auth.auth.getSession()
    if (!data.session) return
    const headers = { Authorization: `Bearer ${data.session.access_token}` }
    const sessionResponse = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/me`, { headers, cache: 'no-store' })
    if (!sessionResponse.ok) return
    const session = sessionContextResponseSchema.parse(await sessionResponse.json())
    const tenant = session.tenants.find((entry) => entry.isOwner) ?? session.tenants[0]
    if (!tenant) return
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/notifications?unreadOnly=true&limit=1&offset=0`, {
      headers: { ...headers, 'X-Tenant-Id': tenant.tenantId },
      cache: 'no-store',
    })
    if (response.ok) setUnread(notificationCenterSchema.parse(await response.json()).unreadCount)
  }, [])

  useEffect(() => {
    void load().catch(() => undefined)
    const refresh = () => void load().catch(() => undefined)
    window.addEventListener('hcs:notifications-changed', refresh)
    return () => window.removeEventListener('hcs:notifications-changed', refresh)
  }, [load])

  return (
    <Link
      href="/notifications"
      aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      className="relative flex size-11 items-center justify-center rounded-control border border-ink-900/[0.14] bg-white/70 text-ink-900"
    >
      <Bell size={20} strokeWidth={1.75} />
      {unread ? (
        <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Link>
  )
}
