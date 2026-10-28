'use client'
import { useEffect, useRef, useState } from 'react'
import { inventoryCountStaffAccessSchema, type WorkforceContext } from '@hcs/contracts'
import { Button } from '@hcs/ui'
import { z } from 'zod'

const pendingSchema = z.strictObject({
  key: z.uuid(),
  body: inventoryCountStaffAccessSchema,
  actor: z.uuid(),
  tenant: z.uuid(),
})
type Pending = z.infer<typeof pendingSchema>
const apiUrl = process.env.NEXT_PUBLIC_API_URL
export function CountStaffAccess({
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
  const [pending, setPending] = useState<Pending | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const lock = useRef(false),
    storage = `hcs-count-access:${tenant}:${actor}`
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storage)
      if (raw) {
        const item = pendingSchema.parse(JSON.parse(raw))
        if (item.actor !== actor || item.tenant !== tenant) throw new Error()
        setPending(item)
      }
    } catch {
      setBlocked(true)
      setError('Saved access request needs reconciliation.')
    }
  }, [storage, actor, tenant])
  async function execute(item: Pending) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      if (!apiUrl) throw new Error('Back Office API URL is not configured.')
      if (sessionStorage.getItem(storage) !== JSON.stringify(item))
        throw new Error('Saved access request changed; reconciliation required.')
      const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/inventory/count-staff-access`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Tenant-Id': tenant,
          'Content-Type': 'application/json',
          'Idempotency-Key': item.key,
        },
        body: JSON.stringify(item.body),
      })
      const raw: unknown = await response.json()
      if (!response.ok)
        throw new Error((raw as { error?: { message?: string } }).error?.message ?? 'Access request failed.')
      const result = inventoryCountStaffAccessSchema.parse(raw)
      if (JSON.stringify(result) !== JSON.stringify(item.body))
        throw new Error('Access response does not match request.')
      await refresh()
      if (sessionStorage.getItem(storage) !== JSON.stringify(item))
        throw new Error('Saved access request changed; reconciliation required.')
      sessionStorage.removeItem(storage)
      setPending(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Access outcome is unknown.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function change(employeeId: string, locationId: string, enabled: boolean) {
    if (pending || busy || blocked || lock.current) return
    try {
      const item = pendingSchema.parse({
        key: crypto.randomUUID(),
        body: { employeeId, locationId, enabled },
        actor,
        tenant,
      })
      if (sessionStorage.getItem(storage)) throw new Error('A previous access request needs reconciliation.')
      sessionStorage.setItem(storage, JSON.stringify(item))
      setPending(item)
      await execute(item)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to prepare access request.')
    }
  }
  if (!data.canManageCountAccess) return null
  return (
    <section className="border-t border-ink-900/10 pt-4">
      <h3 className="font-semibold">Physical count staff access</h3>
      <p className="text-sm text-ink-500">
        Give linked staff access to enter counts at an assigned branch. Only an Owner or Manager can create and post
        counts.
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {pending ? (
        <div className="mt-2 text-sm">
          <p>A previous access request needs reconciliation. Retry the original request.</p>
          <Button variant="secondary" disabled={busy} onClick={() => void execute(pending)}>
            Retry access request
          </Button>
        </div>
      ) : null}
      {data.employees.map((employee) => (
        <div key={employee.id} className="mt-3 border-t border-ink-900/10 pt-3">
          <strong className="text-sm">{employee.displayName}</strong>
          {!employee.hasBackOfficeAccount ? (
            <p className="text-sm text-ink-500">
              An active linked Back Office account is required before access can be granted.
            </p>
          ) : null}
          {employee.locationIds.map((locationId) => {
            const location = data.locations.find((row) => row.id === locationId),
              enabled = employee.countAccessLocationIds?.includes(locationId) ?? false
            return (
              <div key={locationId} className="mt-2 flex items-center justify-between gap-2 text-sm">
                <span>
                  {location?.name ?? 'Assigned branch'} · {enabled ? 'Access enabled' : 'No access'}
                </span>
                <Button
                  variant="secondary"
                  disabled={
                    busy ||
                    !!pending ||
                    blocked ||
                    (!enabled && (!employee.hasBackOfficeAccount || !location?.isActive))
                  }
                  onClick={() => void change(employee.id, locationId, !enabled)}
                >
                  {enabled ? 'Revoke count access' : 'Grant count access'}
                </Button>
              </div>
            )
          })}
        </div>
      ))}
    </section>
  )
}
