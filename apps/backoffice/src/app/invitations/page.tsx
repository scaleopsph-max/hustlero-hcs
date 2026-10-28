'use client'
import { useEffect, useRef, useState } from 'react'
import {
  employeeInvitationListSchema,
  employeeInvitationAcceptedSchema,
  sessionContextResponseSchema,
} from '@hcs/contracts'
import { createClient } from '@/lib/supabase-browser'
import { z } from 'zod'
const apiUrl = process.env.NEXT_PUBLIC_API_URL,
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const savedSchema = z.strictObject({ actor: z.uuid(), invitationId: z.uuid(), key: z.uuid() })
type Saved = z.infer<typeof savedSchema>
type Invitation = z.infer<typeof employeeInvitationListSchema>[number]
export default function InvitationsPage() {
  const [actor, setActor] = useState(''),
    [token, setToken] = useState(''),
    [items, setItems] = useState<Invitation[]>([]),
    [pending, setPending] = useState<Saved | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null)
  const lock = useRef(false),
    storage = `hcs-invite-accept:${actor}`
  async function request(path: string, accessToken: string, init?: RequestInit) {
    if (!apiUrl) throw new Error('Back Office API is not configured.')
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      cache: 'no-store',
      headers: { Authorization: `Bearer ${accessToken}`, ...init?.headers },
    })
    const result: unknown = await response.json()
    if (!response.ok)
      throw new Error((result as { error?: { message?: string } }).error?.message ?? 'Invitation request failed.')
    return result
  }
  useEffect(() => {
    if (!supabaseUrl || !supabaseKey) {
      setError('Authentication is not configured.')
      setLoading(false)
      return
    }
    const auth = createClient(supabaseUrl, supabaseKey)
    void auth.auth.getSession().then(async ({ data, error: sessionError }) => {
      try {
        if (sessionError) throw sessionError
        if (!data.session) throw new Error('Sign in with the invited email, then return to this page.')
        const userId = data.session.user.id,
          accessToken = data.session.access_token
        setActor(userId)
        setToken(accessToken)
        try {
          const raw = sessionStorage.getItem(`hcs-invite-accept:${userId}`)
          if (raw) {
            const value = savedSchema.parse(JSON.parse(raw))
            if (value.actor !== userId) throw new Error()
            setPending(value)
          }
        } catch {
          setBlocked(true)
          throw new Error('Saved invitation acceptance needs reconciliation.')
        }
        setItems(employeeInvitationListSchema.parse(await request('/v1/employee-invitations', accessToken)))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Unable to load invitations.')
      } finally {
        setLoading(false)
      }
    })
  }, [])
  async function run(value: Saved) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      if (sessionStorage.getItem(storage) !== JSON.stringify(value))
        throw new Error('Saved acceptance changed; reconciliation required.')
      const result = employeeInvitationAcceptedSchema.parse(
        await request(`/v1/employee-invitations/${value.invitationId}/accept`, token, {
          method: 'POST',
          headers: { 'Idempotency-Key': value.key },
        }),
      )
      if (result.invitationId !== value.invitationId) throw new Error('Acceptance response did not match the request.')
      const membership = sessionContextResponseSchema.parse(await request('/v1/me', token))
      if (!membership.tenants.some((row) => row.tenantId === result.tenantId))
        throw new Error('Membership could not be verified; retry the original request.')
      const next = employeeInvitationListSchema.parse(await request('/v1/employee-invitations', token))
      if (sessionStorage.getItem(storage) !== JSON.stringify(value))
        throw new Error('Saved acceptance changed; reconciliation required.')
      sessionStorage.removeItem(storage)
      setPending(null)
      setItems(next)
      setNotice('Invitation accepted. Open business setup to continue.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Acceptance outcome is unknown.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function accept(invitationId: string) {
    if (pending || blocked || busy || lock.current) return
    try {
      const value = savedSchema.parse({ actor, invitationId, key: crypto.randomUUID() })
      if (sessionStorage.getItem(storage)) throw new Error('A previous acceptance needs reconciliation.')
      sessionStorage.setItem(storage, JSON.stringify(value))
      setPending(value)
      await run(value)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to prepare acceptance.')
    }
  }
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold">Business invitations</h1>
      <p className="mt-2 text-sm">Sign in using the verified email that the business owner invited.</p>
      {loading ? <p className="mt-4">Loading invitations...</p> : null}
      {error ? (
        <p role="alert" className="mt-4 text-red-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-4 text-green-700">
          {notice}
        </p>
      ) : null}
      {pending ? (
        <div className="mt-4">
          <p>A previous acceptance needs reconciliation.</p>
          <button className="rounded bg-ink-900 px-4 py-2 text-white" disabled={busy} onClick={() => void run(pending)}>
            Retry acceptance
          </button>
        </div>
      ) : null}
      {items.map((item) => (
        <div key={item.invitationId} className="mt-4 rounded border p-4">
          <strong>{item.businessName}</strong>
          <p className="text-sm">
            Employee: {item.employeeName} · Expires {new Date(item.expiresAt).toLocaleString()}
          </p>
          <button
            className="mt-2 rounded bg-ink-900 px-4 py-2 text-white disabled:opacity-50"
            disabled={busy || !!pending || blocked}
            onClick={() => void accept(item.invitationId)}
          >
            Accept invitation
          </button>
        </div>
      ))}
      {!loading && token && !items.length && !pending ? (
        <p className="mt-4 text-sm">No pending invitations for this account.</p>
      ) : null}
      <a className="mt-6 inline-block underline" href="/setup">
        Sign in or open business setup
      </a>
    </main>
  )
}
