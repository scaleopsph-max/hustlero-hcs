'use client'
import { useEffect, useRef, useState } from 'react'
import { employeeAccountLinkSchema, type WorkforceContext } from '@hcs/contracts'
import { Button } from '@hcs/ui'
import { z } from 'zod'

const savedSchema = z.strictObject({
  actor: z.uuid(),
  tenant: z.uuid(),
  key: z.uuid(),
  body: employeeAccountLinkSchema,
})
type Saved = z.infer<typeof savedSchema>
const apiUrl = process.env.NEXT_PUBLIC_API_URL
export function EmployeeAccountLink({
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
    [account, setAccount] = useState(''),
    [pending, setPending] = useState<Saved | null>(null),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [error, setError] = useState<string | null>(null)
  const lock = useRef(false),
    storage = `hcs-employee-account-link:${tenant}:${actor}`
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
      setError('Saved link request needs reconciliation.')
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
        throw new Error('Saved link request changed; reconciliation required.')
      const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/workforce/employee-account-link`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Tenant-Id': tenant,
          'Content-Type': 'application/json',
          'Idempotency-Key': value.key,
        },
        body: JSON.stringify(value.body),
      })
      const result: unknown = await response.json()
      if (!response.ok)
        throw new Error((result as { error?: { message?: string } }).error?.message ?? 'Account link failed.')
      if (JSON.stringify(employeeAccountLinkSchema.parse(result)) !== JSON.stringify(value.body))
        throw new Error('Account link response did not match the request.')
      await refresh()
      if (sessionStorage.getItem(storage) !== JSON.stringify(value))
        throw new Error('Saved link request changed; reconciliation required.')
      sessionStorage.removeItem(storage)
      setPending(null)
      setEmployee('')
      setAccount('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Account link outcome is unknown.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function start() {
    if (pending || busy || blocked || lock.current) return
    try {
      const value = savedSchema.parse({
        actor,
        tenant,
        key: crypto.randomUUID(),
        body: { employeeId: employee, userId: account },
      })
      if (sessionStorage.getItem(storage)) throw new Error('A previous link request needs reconciliation.')
      sessionStorage.setItem(storage, JSON.stringify(value))
      setPending(value)
      await run(value)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Select an employee and an account.')
    }
  }
  if (!data.canManageCountAccess) return null
  const employees = data.employees.filter((row) => row.status === 'active' && row.accountLinked === false)
  return (
    <section className="border-t border-ink-900/10 pt-4">
      <h3 className="font-semibold">Link an existing business account</h3>
      <p className="text-sm text-ink-500">
        Link only the matching person. The account keeps its existing business role and receives this employee’s branch
        assignments. This does not create or invite an account.
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {pending ? (
        <div className="mt-2 text-sm">
          <p>A previous link request needs reconciliation.</p>
          <Button variant="secondary" disabled={busy} onClick={() => void run(pending)}>
            Retry account link
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
            {employees.map((row) => (
              <option key={row.id} value={row.id}>
                {row.displayName} ({row.employeeCode})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Existing business account
          <select
            value={account}
            disabled={busy || !!pending || blocked}
            onChange={(event) => setAccount(event.target.value)}
            className="ml-2 rounded border p-2"
          >
            <option value="">Select account</option>
            {(data.unlinkedAccounts ?? []).map((row) => (
              <option key={row.userId} value={row.userId}>
                {row.email}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="secondary"
          disabled={!employee || !account || busy || !!pending || blocked}
          onClick={() => void start()}
        >
          Link account to employee
        </Button>
      </div>
    </section>
  )
}
