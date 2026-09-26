'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { BellRing, CheckCheck, Circle, Loader2, Mail, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  notificationCenterSchema,
  notificationReadResponseSchema,
  notificationsReadAllResponseSchema,
  sessionContextResponseSchema,
  type NotificationCenter as NotificationCenterData,
} from '@hcs/contracts'
import { Button, Chip, Glass, cn, type ChipTone } from '@hcs/ui'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const apiUrl = process.env.NEXT_PUBLIC_API_URL

function client(): SupabaseClient | null {
  return supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null
}

async function apiRequest(path: string, token: string, tenantId: string, auth: SupabaseClient, options?: RequestInit) {
  if (!apiUrl) throw new Error('Back Office API URL is not configured.')
  const request = (accessToken: string) =>
    fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
      ...options,
      cache: 'no-store',
      headers: { Authorization: `Bearer ${accessToken}`, 'X-Tenant-Id': tenantId, ...options?.headers },
    })
  let response = await request(token)
  if (response.status === 401) {
    const refreshed = await auth.auth.refreshSession()
    if (!refreshed.error && refreshed.data.session) response = await request(refreshed.data.session.access_token)
  }
  const data: unknown = await response.json()
  if (!response.ok)
    throw new Error((data as { error?: { message?: string } }).error?.message ?? 'The request could not be completed.')
  return data
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(value))
}

const severityTone: Record<NotificationCenterData['items'][number]['severity'], ChipTone> = {
  info: 'info',
  attention: 'attention',
  warning: 'warning',
  critical: 'critical',
}

export function NotificationCenter() {
  const [auth] = useState(client)
  const [token, setToken] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [data, setData] = useState<NotificationCenterData | null>(null)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!auth) {
      setError('Back Office authentication is not configured.')
      setLoading(false)
      return
    }
    void auth.auth.getSession().then(async ({ data: sessionData, error: sessionError }) => {
      try {
        if (sessionError) throw sessionError
        if (!sessionData.session) throw new Error('Sign in to view notifications.')
        const accessToken = sessionData.session.access_token
        const session = sessionContextResponseSchema.parse(await apiRequest('/v1/me', accessToken, '', auth))
        const tenant = session.tenants.find((entry) => entry.isOwner) ?? session.tenants[0]
        if (!tenant) throw new Error('Create a business first.')
        setToken(accessToken)
        setTenantId(tenant.tenantId)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load notifications.')
        setLoading(false)
      }
    })
  }, [auth])

  const load = useCallback(async () => {
    if (!auth || !token || !tenantId) return
    setLoading(true)
    setError(null)
    try {
      setData(
        notificationCenterSchema.parse(
          await apiRequest(`/v1/notifications?unreadOnly=${unreadOnly}&limit=50&offset=0`, token, tenantId, auth),
        ),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load notifications.')
    } finally {
      setLoading(false)
    }
  }, [auth, tenantId, token, unreadOnly])

  useEffect(() => {
    if (auth && token && tenantId) void load()
  }, [auth, load, tenantId, token])

  async function setRead(notificationId: string, read: boolean) {
    if (!auth || !token || !tenantId) return
    setBusy(notificationId)
    setError(null)
    setNotice(null)
    try {
      notificationReadResponseSchema.parse(
        await apiRequest(`/v1/notifications/${notificationId}`, token, tenantId, auth, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ read }),
        }),
      )
      await load()
      window.dispatchEvent(new Event('hcs:notifications-changed'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the notification.')
    } finally {
      setBusy(null)
    }
  }

  async function markAllRead() {
    if (!auth || !token || !tenantId) return
    setBusy('all')
    setError(null)
    setNotice(null)
    try {
      const response = notificationsReadAllResponseSchema.parse(
        await apiRequest('/v1/notifications/read-all', token, tenantId, auth, { method: 'PATCH' }),
      )
      await load()
      setNotice(`${response.markedCount} notification${response.markedCount === 1 ? '' : 's'} marked read.`)
      window.dispatchEvent(new Event('hcs:notifications-changed'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not mark notifications read.')
    } finally {
      setBusy(null)
    }
  }

  if (loading && !data) {
    return (
      <div className="flex min-h-72 items-center justify-center text-sm text-ink-500">
        <Loader2 size={20} className="mr-2 animate-spin" /> Loading notifications...
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      {error ? <p className="border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      {notice ? (
        <p className="border-l-2 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex border border-ink-900/15 bg-white/70 p-1" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={!unreadOnly}
            onClick={() => setUnreadOnly(false)}
            className={cn('h-9 px-4 text-sm font-semibold', !unreadOnly ? 'bg-ink-900 text-white' : 'text-ink-700')}
          >
            All
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={unreadOnly}
            onClick={() => setUnreadOnly(true)}
            className={cn('h-9 px-4 text-sm font-semibold', unreadOnly ? 'bg-ink-900 text-white' : 'text-ink-700')}
          >
            Unread ({data?.unreadCount ?? 0})
          </button>
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={16} className={cn('mr-2', loading && 'animate-spin')} /> Refresh
          </Button>
          <Button
            size="sm"
            variant="confirm"
            disabled={!data?.unreadCount || busy === 'all'}
            onClick={() => void markAllRead()}
          >
            <CheckCheck size={16} className="mr-2" /> Mark all read
          </Button>
        </div>
      </div>
      <Glass variant="data" className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-ink-900/10 px-5 py-4 text-sm">
          <span className="font-semibold">Notification history</span>
          <span className="text-ink-500">{data?.total ?? 0} records</span>
        </div>
        {data?.items.length ? (
          <div className="divide-y divide-ink-900/10">
            {data.items.map((item) => (
              <article
                key={item.id}
                className={cn('grid gap-3 p-5 sm:grid-cols-[1fr_auto]', !item.readAt && 'bg-gold-50/60')}
              >
                <div className="flex min-w-0 gap-3">
                  <span
                    className={cn('mt-1 size-2 flex-none rounded-full', item.readAt ? 'bg-ink-300' : 'bg-gold-600')}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-base font-bold">{item.title}</h2>
                      <Chip surface="light" tone={severityTone[item.severity]}>
                        {item.severity}
                      </Chip>
                      <Chip surface="light">{item.category}</Chip>
                    </div>
                    <p className="mt-1 text-sm text-ink-700">{item.message}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                      <span>{formatDate(item.createdAt)}</span>
                      <span>{item.locationName ?? 'Business-wide'}</span>
                      <span className="inline-flex items-center gap-1">
                        <BellRing size={13} /> In-app {item.delivery.inApp}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Mail size={13} /> Email {item.delivery.email.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-5 sm:pl-0">
                  <button
                    type="button"
                    title={item.readAt ? 'Mark unread' : 'Mark read'}
                    aria-label={item.readAt ? 'Mark unread' : 'Mark read'}
                    disabled={busy === item.id}
                    onClick={() => void setRead(item.id, !item.readAt)}
                    className="grid size-10 place-items-center border border-ink-900/15 bg-white text-ink-700 disabled:opacity-50"
                  >
                    {item.readAt ? <Circle size={17} /> : <CheckCheck size={17} />}
                  </button>
                  <Link
                    href={item.href}
                    className="inline-flex min-h-10 items-center border border-ink-900/15 bg-ink-900 px-3 text-sm font-semibold text-white"
                  >
                    Open record
                  </Link>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center p-8 text-center">
            <div>
              <BellRing className="mx-auto text-ink-400" size={28} />
              <h2 className="mt-3 font-display text-xl font-bold">
                {unreadOnly ? 'You are all caught up' : 'No notifications yet'}
              </h2>
              <p className="mt-1 text-sm text-ink-500">Alert and approval updates for your role will appear here.</p>
            </div>
          </div>
        )}
      </Glass>
    </div>
  )
}
