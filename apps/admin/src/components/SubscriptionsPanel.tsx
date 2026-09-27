'use client'

import { subscriptionContextSchema, type SubscriptionContext } from '@hcs/contracts'
import { Button, Chip, Glass } from '@hcs/ui'
import { CalendarClock, Layers3, Plus, RefreshCw } from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787').replace(/\/$/, '')
const fieldClass =
  'h-11 w-full rounded-[6px] border border-white/15 bg-black/25 px-3 text-sm text-white outline-none focus:border-gold-400'

export function SubscriptionsPanel({ getAccessToken }: { getAccessToken: () => Promise<string | null> }) {
  const [context, setContext] = useState<SubscriptionContext | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [planName, setPlanName] = useState('')
  const [planCode, setPlanCode] = useState('')
  const [trialDays, setTrialDays] = useState('0')
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>(['catalog', 'sales', 'reports'])
  const [featureLimits, setFeatureLimits] = useState<Record<string, string>>({})
  const [tenantId, setTenantId] = useState('')
  const [planId, setPlanId] = useState('')
  const [assignmentKind, setAssignmentKind] = useState<'active' | 'trial'>('active')
  const [assignmentEnd, setAssignmentEnd] = useState('')
  const [assignmentReason, setAssignmentReason] = useState('')
  const [overrideFeature, setOverrideFeature] = useState('')
  const [overrideEnd, setOverrideEnd] = useState('')
  const [overrideReason, setOverrideReason] = useState('')

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getAccessToken()
      if (!token) throw new Error('Your platform session has expired. Sign in again.')
      const response = await fetch(`${apiUrl}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error?.message ?? 'The subscription operation failed.')
      return payload
    },
    [getAccessToken],
  )

  const load = useCallback(async () => {
    setBusy(true)
    setMessage('')
    try {
      const parsed = subscriptionContextSchema.parse(await request('/v1/platform/subscriptions'))
      setContext(parsed)
      setTenantId((current) => current || parsed.tenants[0]?.tenantId || '')
      setPlanId((current) => current || parsed.plans[0]?.id || '')
      setOverrideFeature((current) => current || parsed.features[0]?.code || '')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load subscriptions.')
    } finally {
      setBusy(false)
    }
  }, [request])

  useEffect(() => {
    void load()
  }, [load])

  const selectedTenant = useMemo(
    () => context?.tenants.find((tenant) => tenant.tenantId === tenantId) ?? null,
    [context, tenantId],
  )

  function dateAtEndOfDay(value: string) {
    return value ? new Date(`${value}T23:59:59`).toISOString() : null
  }

  async function createPlan(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await request('/v1/platform/subscription-plans', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          code: planCode,
          name: planName,
          defaultTrialDays: Number(trialDays),
          features: selectedFeatures.map((featureCode) => ({
            featureCode,
            limitValue: featureLimits[featureCode] ? Number(featureLimits[featureCode]) : null,
          })),
        }),
      })
      setPlanName('')
      setPlanCode('')
      setTrialDays('0')
      setSelectedFeatures(['catalog', 'sales', 'reports'])
      setFeatureLimits({})
      setMessage('Subscription plan created.')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create the plan.')
    } finally {
      setBusy(false)
    }
  }

  async function assignPlan(event: FormEvent) {
    event.preventDefault()
    if (!tenantId || !planId) return
    setBusy(true)
    setMessage('')
    try {
      await request(`/v1/platform/tenants/${tenantId}/subscription`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          planId,
          trialEndsAt: assignmentKind === 'trial' ? dateAtEndOfDay(assignmentEnd) : null,
          endsAt: assignmentKind === 'active' ? dateAtEndOfDay(assignmentEnd) : null,
          reason: assignmentReason,
        }),
      })
      setAssignmentReason('')
      setAssignmentEnd('')
      setMessage('Tenant subscription assigned.')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not assign the plan.')
    } finally {
      setBusy(false)
    }
  }

  async function createOverride(event: FormEvent) {
    event.preventDefault()
    if (!tenantId || !overrideFeature) return
    setBusy(true)
    setMessage('')
    try {
      await request(`/v1/platform/tenants/${tenantId}/feature-overrides`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          featureCode: overrideFeature,
          endsAt: dateAtEndOfDay(overrideEnd),
          reason: overrideReason,
        }),
      })
      setOverrideReason('')
      setOverrideEnd('')
      setMessage('Temporary add-on access granted.')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create the override.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <h2 className="font-display text-xl font-bold">Subscriptions & Add-ons</h2>
            <p className="mt-1 text-sm text-ink-300">Manual pilot plans, trials, limits, and temporary access.</p>
          </div>
          <Button size="sm" onClick={() => void load()} disabled={busy} title="Refresh subscriptions">
            <RefreshCw size={16} /> Refresh
          </Button>
        </div>
        {message ? (
          <div className="mt-4 border-l-2 border-gold-400 bg-white/[0.05] px-4 py-3 text-sm">{message}</div>
        ) : null}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/15 text-left text-xs uppercase text-ink-300">
                <th className="py-3 pr-3">Plan</th>
                <th className="px-3 py-3">Modules</th>
                <th className="px-3 py-3">Trial</th>
                <th className="py-3 pl-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {context?.plans.map((plan) => (
                <tr key={plan.id} className="border-b border-white/[0.08]">
                  <td className="py-4 pr-3">
                    <strong>{plan.name}</strong>
                    <span className="block text-xs text-ink-400">{plan.code}</span>
                  </td>
                  <td className="px-3 py-4">{plan.features.length}</td>
                  <td className="px-3 py-4">{plan.defaultTrialDays ? `${plan.defaultTrialDays} days` : 'None'}</td>
                  <td className="py-4 pl-3">
                    <Chip tone={plan.status === 'active' ? 'success' : 'neutral'}>{plan.status}</Chip>
                  </td>
                </tr>
              ))}
              {!context?.plans.length ? (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-ink-400">
                    No subscription plans yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {context?.canManage ? (
          <Glass className="mt-5 rounded-[8px] p-4">
            <div className="flex items-center gap-2">
              <Plus size={18} className="text-gold-300" />
              <h3 className="font-display font-bold">New plan</h3>
            </div>
            <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={createPlan}>
              <label className="text-sm font-semibold">
                Name
                <input
                  className={`${fieldClass} mt-1.5`}
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  required
                />
              </label>
              <label className="text-sm font-semibold">
                Code
                <input
                  className={`${fieldClass} mt-1.5`}
                  value={planCode}
                  onChange={(e) => setPlanCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  required
                />
              </label>
              <label className="text-sm font-semibold">
                Default trial days
                <input
                  className={`${fieldClass} mt-1.5`}
                  type="number"
                  min="0"
                  max="365"
                  value={trialDays}
                  onChange={(e) => setTrialDays(e.target.value)}
                  required
                />
              </label>
              <fieldset className="sm:col-span-2">
                <legend className="text-sm font-semibold">Included modules</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {context?.features.map((feature) => {
                    const required = ['catalog', 'sales', 'reports'].includes(feature.code)
                    const selected = required || selectedFeatures.includes(feature.code)
                    return (
                      <div key={feature.code} className="grid grid-cols-[1fr_88px] items-center gap-2">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={required}
                            onChange={(e) =>
                              setSelectedFeatures((current) =>
                                e.target.checked
                                  ? [...current, feature.code]
                                  : current.filter((code) => code !== feature.code),
                              )
                            }
                          />
                          {feature.name}
                          {required ? ' (core)' : ''}
                        </label>
                        <input
                          className="h-9 rounded-[6px] border border-white/15 bg-black/25 px-2 text-sm text-white outline-none disabled:opacity-40"
                          type="number"
                          min="0"
                          placeholder="Limit"
                          aria-label={`${feature.name} limit`}
                          disabled={!selected}
                          value={featureLimits[feature.code] ?? ''}
                          onChange={(e) =>
                            setFeatureLimits((current) => ({ ...current, [feature.code]: e.target.value }))
                          }
                        />
                      </div>
                    )
                  })}
                </div>
              </fieldset>
              <Button className="sm:col-span-2" type="submit" variant="confirm" disabled={busy}>
                Create plan
              </Button>
            </form>
          </Glass>
        ) : null}
      </section>
      <aside className="border-l-0 border-white/10 xl:border-l xl:pl-4">
        <div className="flex items-center gap-2">
          <Layers3 size={18} className="text-gold-300" />
          <h3 className="font-display text-lg font-bold">Tenant assignment</h3>
        </div>
        <label className="mt-4 block text-sm font-semibold">
          Tenant
          <select className={`${fieldClass} mt-1.5`} value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            {context?.tenants.map((tenant) => (
              <option key={tenant.tenantId} value={tenant.tenantId}>
                {tenant.tenantName}
              </option>
            ))}
          </select>
        </label>
        {selectedTenant?.subscription ? (
          <div className="mt-3 border-l-2 border-signal-dark-success-fg bg-signal-dark-success-bg px-3 py-2 text-sm">
            <strong>{selectedTenant.subscription.planName}</strong>
            <span className="block text-xs text-ink-300">
              {selectedTenant.subscription.status}
              {selectedTenant.subscription.endsAt
                ? ` · until ${new Date(selectedTenant.subscription.endsAt).toLocaleDateString()}`
                : ''}
            </span>
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-400">No active subscription.</p>
        )}
        {context?.canManage ? (
          <form className="mt-5 flex flex-col gap-3" onSubmit={assignPlan}>
            <label className="text-sm font-semibold">
              Plan
              <select
                className={`${fieldClass} mt-1.5`}
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                required
              >
                {context.plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold">
              Assignment
              <select
                className={`${fieldClass} mt-1.5`}
                value={assignmentKind}
                onChange={(e) => setAssignmentKind(e.target.value as 'active' | 'trial')}
              >
                <option value="active">Active</option>
                <option value="trial">Trial</option>
              </select>
            </label>
            <label className="text-sm font-semibold">
              {assignmentKind === 'trial' ? 'Trial end' : 'End date (optional)'}
              <input
                className={`${fieldClass} mt-1.5`}
                type="date"
                value={assignmentEnd}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setAssignmentEnd(e.target.value)}
                required={assignmentKind === 'trial'}
              />
            </label>
            <label className="text-sm font-semibold">
              Reason
              <input
                className={`${fieldClass} mt-1.5`}
                value={assignmentReason}
                maxLength={240}
                onChange={(e) => setAssignmentReason(e.target.value)}
                required
              />
            </label>
            <Button type="submit" variant="confirm" disabled={busy || !planId || assignmentReason.trim().length < 3}>
              Assign plan
            </Button>
          </form>
        ) : null}
        <div className="mt-7 border-t border-white/10 pt-5">
          <div className="flex items-center gap-2">
            <CalendarClock size={18} className="text-gold-300" />
            <h3 className="font-display font-bold">Temporary add-on</h3>
          </div>
          {selectedTenant?.activeOverrides.map((override) => (
            <div key={override.id} className="mt-3 border-b border-white/10 pb-3 text-sm">
              <strong>{override.featureName ?? override.featureCode}</strong>
              <span className="block text-xs text-ink-400">
                Until {new Date(override.endsAt).toLocaleDateString()} · {override.reason}
              </span>
            </div>
          ))}
          {context?.canManage ? (
            <form className="mt-4 flex flex-col gap-3" onSubmit={createOverride}>
              <label className="text-sm font-semibold">
                Module
                <select
                  className={`${fieldClass} mt-1.5`}
                  value={overrideFeature}
                  onChange={(e) => setOverrideFeature(e.target.value)}
                >
                  {context.features.map((feature) => (
                    <option key={feature.code} value={feature.code}>
                      {feature.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-semibold">
                Expires
                <input
                  className={`${fieldClass} mt-1.5`}
                  type="date"
                  value={overrideEnd}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setOverrideEnd(e.target.value)}
                  required
                />
              </label>
              <label className="text-sm font-semibold">
                Reason
                <input
                  className={`${fieldClass} mt-1.5`}
                  value={overrideReason}
                  maxLength={240}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  required
                />
              </label>
              <Button type="submit" disabled={busy || overrideReason.trim().length < 3}>
                Grant temporary access
              </Button>
            </form>
          ) : null}
        </div>
      </aside>
    </div>
  )
}
