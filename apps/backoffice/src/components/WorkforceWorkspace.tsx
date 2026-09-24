'use client'

import { createClient } from '@supabase/supabase-js'
import { Building2, Monitor, Plus, UserRound } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  employeeCreateResponseSchema,
  locationCreateResponseSchema,
  registerCreateResponseSchema,
  sessionContextResponseSchema,
  workforceContextSchema,
  type WorkforceContext,
} from '@hcs/contracts'
import { Button, Chip, Glass } from '@hcs/ui'

const apiUrl = process.env.NEXT_PUBLIC_API_URL
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const input =
  'min-h-11 w-full rounded-control border border-ink-900/15 bg-white/80 px-3 text-sm outline-none focus:border-ink-900'
async function call(path: string, token: string, tenantId: string, options: RequestInit = {}) {
  if (!apiUrl) throw new Error('Back Office API URL is not configured.')
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenantId, ...options.headers },
  })
  const data: unknown = await response.json()
  if (!response.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? 'Request failed.')
  return data
}
export function WorkforceWorkspace({ focus = 'employees' }: { focus?: 'employees' | 'locations' | 'registers' }) {
  const [auth] = useState(() => (supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null))
  const [token, setToken] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [data, setData] = useState<WorkforceContext>({ locations: [], roles: [], employees: [], registers: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [employeeCode, setEmployeeCode] = useState('EMP-001')
  const [displayName, setDisplayName] = useState('')
  const [roleId, setRoleId] = useState('')
  const [employeeLocation, setEmployeeLocation] = useState('')
  const [pin, setPin] = useState('')
  const [locationCode, setLocationCode] = useState('BR-002')
  const [locationName, setLocationName] = useState('')
  const [kind, setKind] = useState<'store' | 'warehouse' | 'office' | 'virtual'>('store')
  const [registerCode, setRegisterCode] = useState('REG-001')
  const [registerName, setRegisterName] = useState('Main Register')
  const [registerLocation, setRegisterLocation] = useState('')
  const load = useCallback(async (t: string, tenant: string) => {
    const next = workforceContextSchema.parse(await call('/v1/workforce', t, tenant))
    setData(next)
    setRoleId((v) => v || next.roles.find((r) => r.code === 'cashier')?.id || next.roles[0]?.id || '')
    setEmployeeLocation((v) => v || next.locations.find((l) => l.isActive)?.id || '')
    setRegisterLocation((v) => v || next.locations.find((l) => l.isActive)?.id || '')
  }, [])
  useEffect(() => {
    if (!auth) {
      setLoading(false)
      return
    }
    void auth.auth.getSession().then(async ({ data: sessionData, error: sessionError }) => {
      try {
        if (sessionError) throw sessionError
        if (!sessionData.session) throw new Error('Sign in to manage the business.')
        setToken(sessionData.session.access_token)
        const session = sessionContextResponseSchema.parse(await call('/v1/me', sessionData.session.access_token, ''))
        const tenant = session.tenants.find((item) => item.isOwner) ?? session.tenants[0]
        if (!tenant) throw new Error('Create a business first.')
        setTenantId(tenant.tenantId)
        await load(sessionData.session.access_token, tenant.tenantId)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load workforce setup.')
      } finally {
        setLoading(false)
      }
    })
  }, [auth, load])
  async function submit(path: string, body: unknown, parse: (v: unknown) => unknown) {
    if (!token || !tenantId) return
    setBusy(true)
    setError(null)
    try {
      parse(
        await call(path, token, tenantId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `workforce-${crypto.randomUUID()}` },
          body: JSON.stringify(body),
        }),
      )
      await load(token, tenantId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save changes.')
    } finally {
      setBusy(false)
    }
  }
  if (loading)
    return (
      <Glass variant="light" className="p-8 text-sm text-ink-500">
        Loading workforce setup...
      </Glass>
    )
  const employeeForm = (event: FormEvent) => {
    event.preventDefault()
    void submit(
      '/v1/workforce/employees',
      { employeeCode, displayName, roleId, locationIds: [employeeLocation], pin },
      employeeCreateResponseSchema.parse,
    )
  }
  const locationForm = (event: FormEvent) => {
    event.preventDefault()
    void submit(
      '/v1/workforce/locations',
      { code: locationCode, name: locationName, kind, timezone: 'Asia/Manila' },
      locationCreateResponseSchema.parse,
    )
  }
  const registerForm = (event: FormEvent) => {
    event.preventDefault()
    void submit(
      '/v1/workforce/registers',
      { locationId: registerLocation, code: registerCode, name: registerName },
      registerCreateResponseSchema.parse,
    )
  }
  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      {error ? (
        <div className="border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-700 xl:col-span-2">{error}</div>
      ) : null}
      <Glass variant="light" className="p-5">
        {focus === 'employees' ? (
          <>
            <div className="mb-4 flex items-center gap-3">
              <UserRound size={22} />
              <div>
                <h2 className="font-display text-xl font-bold">Add employee</h2>
                <p className="text-sm text-ink-500">POS PIN is hashed and never shown again.</p>
              </div>
            </div>
            <form className="grid gap-3" onSubmit={employeeForm}>
              <input
                className={input}
                value={employeeCode}
                onChange={(e) => setEmployeeCode(e.target.value)}
                placeholder="Employee code"
                required
              />
              <input
                className={input}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Display name"
                required
              />
              <select className={input} value={roleId} onChange={(e) => setRoleId(e.target.value)} required>
                {data.roles
                  .filter((r) => r.code !== 'owner')
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
              <select
                className={input}
                value={employeeLocation}
                onChange={(e) => setEmployeeLocation(e.target.value)}
                required
              >
                {data.locations
                  .filter((l) => l.isActive)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
              <input
                className={input}
                type="password"
                inputMode="numeric"
                pattern="[0-9]{4,6}"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="4 to 6 digit POS PIN"
                required
              />
              <Button type="submit" variant="primary" size="sm" disabled={busy}>
                <Plus size={16} className="mr-2" />
                Add employee
              </Button>
            </form>
          </>
        ) : focus === 'locations' ? (
          <>
            <div className="mb-4 flex items-center gap-3">
              <Building2 size={22} />
              <h2 className="font-display text-xl font-bold">Add location</h2>
            </div>
            <form className="grid gap-3" onSubmit={locationForm}>
              <input
                className={input}
                value={locationCode}
                onChange={(e) => setLocationCode(e.target.value)}
                placeholder="Branch code"
                required
              />
              <input
                className={input}
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder="Location name"
                required
              />
              <select className={input} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="store">Store</option>
                <option value="warehouse">Warehouse</option>
                <option value="office">Office</option>
                <option value="virtual">Virtual</option>
              </select>
              <Button type="submit" variant="primary" size="sm" disabled={busy}>
                <Plus size={16} className="mr-2" />
                Add location
              </Button>
            </form>
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              <Monitor size={22} />
              <h2 className="font-display text-xl font-bold">Add register</h2>
            </div>
            <form className="grid gap-3" onSubmit={registerForm}>
              <select
                className={input}
                value={registerLocation}
                onChange={(e) => setRegisterLocation(e.target.value)}
                required
              >
                {data.locations
                  .filter((l) => l.isActive)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
              <input
                className={input}
                value={registerCode}
                onChange={(e) => setRegisterCode(e.target.value)}
                placeholder="Register code"
                required
              />
              <input
                className={input}
                value={registerName}
                onChange={(e) => setRegisterName(e.target.value)}
                placeholder="Register name"
                required
              />
              <Button type="submit" variant="primary" size="sm" disabled={busy}>
                <Plus size={16} className="mr-2" />
                Add register
              </Button>
            </form>
          </>
        )}
      </Glass>
      <Glass variant="data" className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-bold">Business access setup</h2>
            <p className="text-sm text-ink-500">Employees, branch assignments, roles, and POS registers.</p>
          </div>
          <Chip tone="neutral">{data.employees.length} employees</Chip>
        </div>
        <div className="grid gap-5">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase text-ink-500">Employees</h3>
            {data.employees.length ? (
              data.employees.map((e) => (
                <div key={e.id} className="flex justify-between border-t border-ink-900/10 py-3 text-sm">
                  <span className="font-semibold">
                    {e.displayName} <span className="text-ink-500">({e.employeeCode})</span>
                  </span>
                  <Chip tone={e.status === 'active' ? 'success' : 'neutral'}>{e.status}</Chip>
                </div>
              ))
            ) : (
              <p className="text-sm text-ink-500">No employees yet.</p>
            )}
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase text-ink-500">Locations</h3>
            {data.locations.map((l) => (
              <div key={l.id} className="flex justify-between border-t border-ink-900/10 py-3 text-sm">
                <span className="font-semibold">{l.name}</span>
                <span className="text-ink-500">
                  {l.code} · {l.kind}
                </span>
              </div>
            ))}
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase text-ink-500">Registers</h3>
            {data.registers.length ? (
              data.registers.map((r) => (
                <div key={r.id} className="flex justify-between border-t border-ink-900/10 py-3 text-sm">
                  <span className="font-semibold">{r.name}</span>
                  <span className="text-ink-500">
                    {r.locationName} · {r.code}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-sm text-ink-500">No registers yet.</p>
            )}
          </section>
        </div>
      </Glass>
    </div>
  )
}
