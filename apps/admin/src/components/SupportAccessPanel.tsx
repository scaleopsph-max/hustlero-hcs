'use client'

import {
  supportAccessContextSchema,
  supportAccessGrantSchema,
  supportAccessOverviewSchema,
  type PlatformContext,
  type SupportAccessContext,
  type SupportAccessGrant,
  type SupportAccessOverview,
} from '@hcs/contracts'
import { Building2, Clock3, Eye, RefreshCw, ShieldCheck, ShieldOff, TicketCheck } from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Chip, Glass } from '@hcs/ui'

const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787').replace(/\/$/, '')
const fieldClass =
  'h-11 w-full rounded-[6px] border border-white/15 bg-black/25 px-3 text-sm text-white outline-none placeholder:text-ink-400 focus:border-gold-400'

interface Props {
  tenants: PlatformContext['tenants']
  canGrant: boolean
  getAccessToken: () => Promise<string | null>
}

export function SupportAccessPanel({ tenants, canGrant, getAccessToken }: Props) {
  const [access, setAccess] = useState<SupportAccessContext | null>(null)
  const [overview, setOverview] = useState<SupportAccessOverview | null>(null)
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? '')
  const [ticketReference, setTicketReference] = useState('')
  const [reason, setReason] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(30)
  const [revokeGrant, setRevokeGrant] = useState<SupportAccessGrant | null>(null)
  const [revocationReason, setRevocationReason] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getAccessToken()
      if (!token) throw new Error('Your platform session has expired. Sign in again.')
      const response = await fetch(`${apiUrl}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, ...init?.headers },
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const detail =
          typeof payload === 'object' && payload && 'error' in payload
            ? (payload.error as { message?: string }).message
            : null
        throw new Error(detail ?? 'The support access operation failed.')
      }
      return payload
    },
    [getAccessToken],
  )

  const loadAccess = useCallback(async () => {
    setMessage('')
    try {
      setAccess(supportAccessContextSchema.parse(await request('/v1/platform/support-access')))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Support access could not be loaded.')
    }
  }, [request])

  useEffect(() => {
    void loadAccess()
  }, [loadAccess])

  const activeGrantIds = useMemo(
    () =>
      new Set(
        (access?.grants ?? [])
          .filter((grant) => !grant.revokedAt && new Date(grant.expiresAt).getTime() > Date.now())
          .map((grant) => grant.id),
      ),
    [access],
  )

  async function createGrant(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await request('/v1/platform/support-access', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          tenantId,
          ticketReference: ticketReference.trim(),
          reason: reason.trim(),
          durationMinutes,
        }),
      })
      setTicketReference('')
      setReason('')
      await loadAccess()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Support access could not be created.')
    } finally {
      setBusy(false)
    }
  }

  async function openOverview(grantId: string) {
    setBusy(true)
    setMessage('')
    try {
      setOverview(supportAccessOverviewSchema.parse(await request(`/v1/platform/support-access/${grantId}/overview`)))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The tenant overview could not be loaded.')
      await loadAccess()
    } finally {
      setBusy(false)
    }
  }

  async function revoke(event: FormEvent) {
    event.preventDefault()
    if (!revokeGrant) return
    setBusy(true)
    setMessage('')
    try {
      supportAccessGrantSchema.parse(
        await request(`/v1/platform/support-access/${revokeGrant.id}/revoke`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
          body: JSON.stringify({ reason: revocationReason.trim() }),
        }),
      )
      setRevokeGrant(null)
      setRevocationReason('')
      setOverview(null)
      await loadAccess()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Support access could not be revoked.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Glass variant="gold" className="rounded-[8px] p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck size={22} className="mt-0.5 flex-none text-gold-300" />
          <div>
            <h2 className="font-display text-lg font-bold">Time-boxed support access</h2>
            <p className="mt-1 text-sm text-ink-200">
              Access is read-only, limited to operational totals and locations, expires automatically, and records every
              overview visit in the tenant audit trail.
            </p>
          </div>
        </div>
      </Glass>

      {message ? (
        <div className="border-l-2 border-signal-dark-critical-fg bg-signal-dark-critical-bg px-4 py-3 text-sm text-signal-dark-critical-fg">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <section className="border-r-0 border-white/10 xl:border-r xl:pr-4">
          <div className="mb-4 flex items-center gap-2">
            <TicketCheck size={18} className="text-gold-300" />
            <h3 className="font-display text-lg font-bold">Start access session</h3>
          </div>
          {canGrant && access?.canGrant ? (
            <form className="flex flex-col gap-3" onSubmit={createGrant}>
              <label className="text-sm font-semibold">
                Tenant
                <select
                  className={`${fieldClass} mt-1.5`}
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                >
                  {tenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.name} ({tenant.status})
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-semibold">
                Ticket reference
                <input
                  className={`${fieldClass} mt-1.5`}
                  value={ticketReference}
                  onChange={(e) => setTicketReference(e.target.value)}
                  placeholder="SUP-1042"
                  minLength={3}
                  maxLength={120}
                  required
                />
              </label>
              <label className="text-sm font-semibold">
                Reason
                <textarea
                  className={`${fieldClass} mt-1.5 h-24 resize-none py-3`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe the issue being investigated"
                  minLength={3}
                  maxLength={240}
                  required
                />
              </label>
              <label className="text-sm font-semibold">
                Duration
                <select
                  className={`${fieldClass} mt-1.5`}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                >
                  {[15, 30, 60, 120].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutes
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="submit"
                variant="primary"
                disabled={busy || !tenantId || ticketReference.trim().length < 3 || reason.trim().length < 3}
              >
                <ShieldCheck size={16} /> {busy ? 'Starting...' : 'Start read-only access'}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-ink-300">
              Your platform role can view its history but cannot issue support access.
            </p>
          )}
        </section>

        <section className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-lg font-bold">Your access history</h3>
              <p className="text-xs text-ink-300">Most recent 100 grants</p>
            </div>
            <Button size="sm" onClick={() => void loadAccess()} title="Refresh support access" disabled={busy}>
              <RefreshCw size={16} />
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {access?.grants.length ? (
              access.grants.map((grant) => {
                const active = activeGrantIds.has(grant.id)
                return (
                  <div key={grant.id} className="rounded-[6px] border border-white/10 bg-black/15 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong>{grant.tenantName}</strong>
                          <Chip tone={active ? 'success' : grant.revokedAt ? 'warning' : 'neutral'}>
                            {active ? 'active' : grant.revokedAt ? 'revoked' : 'expired'}
                          </Chip>
                        </div>
                        <p className="mt-1 text-xs text-ink-300">
                          {grant.ticketReference} · expires {new Date(grant.expiresAt).toLocaleString()}
                        </p>
                        <p className="mt-2 text-sm text-ink-200">{grant.reason}</p>
                      </div>
                      {active ? (
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => void openOverview(grant.id)} disabled={busy}>
                            <Eye size={16} /> Open
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setRevokeGrant(grant)} disabled={busy}>
                            <ShieldOff size={16} /> Revoke
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })
            ) : (
              <p className="py-12 text-center text-sm text-ink-300">No support access sessions yet.</p>
            )}
          </div>
        </section>
      </div>

      {overview ? <OverviewDialog overview={overview} close={() => setOverview(null)} /> : null}
      {revokeGrant ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <Glass variant="strong" className="w-full max-w-lg rounded-[8px] p-5">
            <h2 className="font-display text-xl font-bold">Revoke support access</h2>
            <p className="mt-2 text-sm text-ink-300">The session for {revokeGrant.tenantName} will stop immediately.</p>
            <form className="mt-5 flex flex-col gap-3" onSubmit={revoke}>
              <label className="text-sm font-semibold">
                Revocation reason
                <input
                  className={`${fieldClass} mt-1.5`}
                  value={revocationReason}
                  onChange={(e) => setRevocationReason(e.target.value)}
                  minLength={3}
                  maxLength={240}
                  required
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button type="button" onClick={() => setRevokeGrant(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" variant="danger" disabled={busy || revocationReason.trim().length < 3}>
                  {busy ? 'Revoking...' : 'Revoke access'}
                </Button>
              </div>
            </form>
          </Glass>
        </div>
      ) : null}
    </div>
  )
}

function OverviewDialog({ overview, close }: { overview: SupportAccessOverview; close: () => void }) {
  const metrics = [
    ['Locations', overview.metrics.locationCount],
    ['Active members', overview.metrics.activeMemberCount],
    ['Employees', overview.metrics.activeEmployeeCount],
    ['Products', overview.metrics.activeProductCount],
    ['Variants', overview.metrics.activeVariantCount],
    ['Stock positions', overview.metrics.inventoryPositionCount],
    ['Registers', overview.metrics.registerCount],
    ['Open sessions', overview.metrics.openRegisterSessionCount],
    ['Completed sales', overview.metrics.completedSaleCount],
  ] as const
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 p-4" role="dialog" aria-modal="true">
      <Glass variant="strong" className="mx-auto my-6 w-full max-w-5xl rounded-[8px] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Building2 size={20} className="text-gold-300" />
              <h2 className="font-display text-xl font-bold">{overview.tenant.name}</h2>
              <Chip tone="success">read-only</Chip>
            </div>
            <p className="mt-2 text-sm text-ink-300">
              {overview.access.ticketReference} · {overview.tenant.timezone} · {overview.tenant.baseCurrency}
            </p>
            <p className="mt-1 flex items-center gap-1 text-xs text-ink-400">
              <Clock3 size={14} /> Expires {new Date(overview.access.expiresAt).toLocaleString()}
            </p>
          </div>
          <Button onClick={close}>Close</Button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {metrics.map(([label, value]) => (
            <div key={label} className="rounded-[6px] border border-white/10 bg-black/20 px-3 py-3">
              <span className="text-xs text-ink-300">{label}</span>
              <strong className="mt-1 block font-display text-xl">{value}</strong>
            </div>
          ))}
        </div>
        <div className="mt-6">
          <h3 className="font-display text-lg font-bold">Locations</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[540px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/15 text-left text-xs uppercase text-ink-300">
                  <th className="py-3">Name</th>
                  <th className="px-3 py-3">Code</th>
                  <th className="px-3 py-3">Kind</th>
                  <th className="py-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {overview.locations.map((location) => (
                  <tr key={location.id} className="border-b border-white/[0.08]">
                    <td className="py-3 font-semibold">{location.name}</td>
                    <td className="px-3 py-3">{location.code}</td>
                    <td className="px-3 py-3">{location.kind}</td>
                    <td className="py-3 text-right">
                      <Chip tone={location.isActive ? 'success' : 'neutral'}>
                        {location.isActive ? 'active' : 'inactive'}
                      </Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Glass>
    </div>
  )
}
