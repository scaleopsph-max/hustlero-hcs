'use client'
import { useEffect, useRef, useState } from 'react'
import {
  employeeInvitationCreateSchema,
  employeeInvitationIssuedSchema,
  employeeInvitationRevokedSchema,
  type WorkforceContext,
} from '@hcs/contracts'
import { Button } from '@hcs/ui'
import { z } from 'zod'
const savedSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('create'),
    actor: z.uuid(),
    tenant: z.uuid(),
    key: z.uuid(),
    body: employeeInvitationCreateSchema,
  }),
  z.strictObject({
    action: z.literal('revoke'),
    actor: z.uuid(),
    tenant: z.uuid(),
    key: z.uuid(),
    invitationId: z.uuid(),
  }),
])
type Saved = z.infer<typeof savedSchema>
const apiUrl = process.env.NEXT_PUBLIC_API_URL
export function EmployeeInvitationOwner({
  actor,
  tenant,
  token,
  data,
  refresh,
}: {
  actor: string
  tenant: string
  token: string
  data: WorkforceContext
  refresh: () => Promise<void>
}) {
  const [employee, setEmployee] = useState(''),
    [email, setEmail] = useState(''),
    [pending, setPending] = useState<Saved | null>(null),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null)
  const lock = useRef(false),
    storage = `hcs-employee-invite:${tenant}:${actor}`
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storage)
      if (raw) {
        const value = savedSchema.parse(JSON.parse(raw))
        if (value.actor !== actor || value.tenant !== tenant) throw new Error()
        setPending(value)
      }
    } catch {
      setBlocked(true)
      setError('Saved invitation request needs reconciliation.')
    }
  }, [storage, actor, tenant])
  async function run(value: Saved) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      if (!apiUrl) throw new Error('Back Office API URL is not configured.')
      if (sessionStorage.getItem(storage) !== JSON.stringify(value))
        throw new Error('Saved invitation request changed; reconciliation required.')
      const path =
        value.action === 'create' ? '/v1/employee-invitations' : `/v1/employee-invitations/${value.invitationId}/revoke`
      const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Tenant-Id': tenant,
          'Content-Type': 'application/json',
          'Idempotency-Key': value.key,
        },
        ...(value.action === 'create' ? { body: JSON.stringify(value.body) } : {}),
      })
      const result: unknown = await response.json()
      if (!response.ok)
        throw new Error((result as { error?: { message?: string } }).error?.message ?? 'Invitation request failed.')
      if (value.action === 'create') {
        const issued = employeeInvitationIssuedSchema.parse(result)
        if (issued.employeeId !== value.body.employeeId || issued.email !== value.body.email)
          throw new Error('Invitation response does not match the request.')
      } else {
        const revoked = employeeInvitationRevokedSchema.parse(result)
        if (revoked.invitationId !== value.invitationId)
          throw new Error('Invitation response does not match the request.')
      }
      await refresh()
      if (sessionStorage.getItem(storage) !== JSON.stringify(value))
        throw new Error('Saved invitation request changed; reconciliation required.')
      sessionStorage.removeItem(storage)
      setPending(null)
      setEmployee('')
      setEmail('')
      setNotice(
        value.action === 'create'
          ? 'Invitation recorded. No email was sent; tell the employee to sign in with the invited email and open Invitations.'
          : 'Invitation revoked.',
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invitation outcome is unknown.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function start(value: Saved) {
    if (pending || busy || blocked || lock.current) return
    try {
      const parsed = savedSchema.parse(value)
      if (sessionStorage.getItem(storage)) throw new Error('A previous invitation request needs reconciliation.')
      sessionStorage.setItem(storage, JSON.stringify(parsed))
      setPending(parsed)
      await run(parsed)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Check invitation details.')
    }
  }
  if (!data.canManageCountAccess) return null
  const available = data.employees.filter((row) => row.status === 'active' && row.accountLinked === false)
  return (
    <section className="border-t border-ink-900/10 pt-4">
      <h3 className="font-semibold">Invite an employee</h3>
      <p className="text-sm text-ink-500">
        Record an invitation for an unlinked employee. No email is sent automatically. The employee must sign in with
        the verified email and open Invitations within seven days.
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-2 text-sm">
          {notice}
        </p>
      ) : null}
      {pending ? (
        <div className="mt-2 text-sm">
          <p>A previous invitation request needs reconciliation.</p>
          <Button variant="secondary" disabled={busy} onClick={() => void run(pending)}>
            Retry invitation request
          </Button>
        </div>
      ) : null}
      <div className="mt-3 grid gap-2">
        <label className="text-sm">
          Employee
          <select
            value={employee}
            disabled={busy || !!pending || blocked}
            onChange={(event) => setEmployee(event.target.value)}
            className="ml-2 rounded border p-2"
          >
            <option value="">Select employee</option>
            {available.map((row) => (
              <option key={row.id} value={row.id}>
                {row.displayName} ({row.employeeCode})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Employee email
          <input
            type="email"
            value={email}
            disabled={busy || !!pending || blocked}
            onChange={(event) => setEmail(event.target.value)}
            className="ml-2 rounded border p-2"
          />
        </label>
        <Button
          variant="secondary"
          disabled={!employee || !email || busy || !!pending || blocked}
          onClick={() =>
            void start({
              action: 'create',
              actor,
              tenant,
              key: crypto.randomUUID(),
              body: { employeeId: employee, email: email.trim().toLowerCase() },
            })
          }
        >
          Record invitation
        </Button>
      </div>
      {(data.pendingEmployeeInvitations ?? []).map((item) => (
        <div
          key={item.invitationId}
          className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm"
        >
          <span>
            {data.employees.find((row) => row.id === item.employeeId)?.displayName ?? 'Employee'} · {item.email} ·
            expires {new Date(item.expiresAt).toLocaleString()}
          </span>
          <Button
            variant="secondary"
            disabled={busy || !!pending || blocked}
            onClick={() =>
              void start({ action: 'revoke', actor, tenant, key: crypto.randomUUID(), invitationId: item.invitationId })
            }
          >
            Revoke invitation
          </Button>
        </div>
      ))}
    </section>
  )
}
