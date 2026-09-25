'use client'

import { createClient } from '@supabase/supabase-js'
import { Copy, KeyRound, Plus, Smartphone } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  posDeviceActivationCreateResponseSchema,
  posDeviceContextSchema,
  sessionContextResponseSchema,
  type PosDeviceContext,
} from '@hcs/contracts'
import { Button, Chip, Glass } from '@hcs/ui'

const apiUrl = process.env.NEXT_PUBLIC_API_URL
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const control =
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

export function PosDevicesWorkspace() {
  const [auth] = useState(() => (supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null))
  const [token, setToken] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [data, setData] = useState<PosDeviceContext>({ registers: [], devices: [] })
  const [registerId, setRegisterId] = useState('')
  const [deviceName, setDeviceName] = useState('Front counter POS')
  const [activation, setActivation] = useState<{ code: string; expiresAt: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (nextToken: string, nextTenantId: string) => {
    const next = posDeviceContextSchema.parse(await call('/v1/pos/devices', nextToken, nextTenantId))
    setData(next)
    setRegisterId((current) => current || next.registers.find((register) => register.status === 'active')?.id || '')
  }, [])

  useEffect(() => {
    if (!auth) {
      setError('Back Office authentication is not configured.')
      setLoading(false)
      return
    }
    void auth.auth.getSession().then(async ({ data: sessionData, error: sessionError }) => {
      try {
        if (sessionError) throw sessionError
        if (!sessionData.session) throw new Error('Sign in to manage POS devices.')
        const nextToken = sessionData.session.access_token
        const session = sessionContextResponseSchema.parse(await call('/v1/me', nextToken, ''))
        const tenant = session.tenants.find((entry) => entry.isOwner) ?? session.tenants[0]
        if (!tenant) throw new Error('Create a business first.')
        setToken(nextToken)
        setTenantId(tenant.tenantId)
        await load(nextToken, tenant.tenantId)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load POS devices.')
      } finally {
        setLoading(false)
      }
    })
  }, [auth, load])

  async function createActivation(event: FormEvent) {
    event.preventDefault()
    if (!token || !tenantId) return
    setBusy(true)
    setError(null)
    setActivation(null)
    try {
      const created = posDeviceActivationCreateResponseSchema.parse(
        await call('/v1/pos/devices/activation-codes', token, tenantId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registerId, name: deviceName }),
        }),
      )
      setActivation({ code: created.activationCode, expiresAt: created.activationExpiresAt })
      await load(token, tenantId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create a device activation.')
    } finally {
      setBusy(false)
    }
  }

  if (loading)
    return (
      <Glass variant="light" className="p-8 text-sm text-ink-500">
        Loading POS devices...
      </Glass>
    )

  const activeRegisters = data.registers.filter((register) => register.status === 'active')

  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      {error ? (
        <div className="border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-700 xl:col-span-2">{error}</div>
      ) : null}
      <Glass variant="light" className="p-5">
        <form className="grid gap-3" onSubmit={createActivation}>
          <div className="mb-1 flex items-center gap-3">
            <Smartphone size={22} />
            <h2 className="font-display text-xl font-bold">Register a POS device</h2>
          </div>
          <select
            className={control}
            value={registerId}
            onChange={(event) => setRegisterId(event.target.value)}
            required
          >
            {!activeRegisters.length ? <option value="">Create an active register first</option> : null}
            {activeRegisters.map((register) => (
              <option key={register.id} value={register.id}>
                {register.locationName} / {register.name}
              </option>
            ))}
          </select>
          <input
            className={control}
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
            placeholder="Device name"
            required
          />
          <Button type="submit" variant="primary" size="sm" disabled={busy || !registerId}>
            <Plus size={16} className="mr-2" />
            Create activation code
          </Button>
        </form>

        {activation ? (
          <div className="mt-6 border-t border-ink-900/10 pt-5">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <KeyRound size={17} /> One-time activation code
            </div>
            <div className="flex items-center justify-between gap-3 border border-gold-500/40 bg-gold-50 p-4">
              <span className="font-display text-2xl font-bold tracking-widest">{activation.code}</span>
              <button
                type="button"
                title="Copy activation code"
                aria-label="Copy activation code"
                className="grid size-10 place-items-center border border-ink-900/15 bg-white"
                onClick={() => void navigator.clipboard.writeText(activation.code)}
              >
                <Copy size={18} />
              </button>
            </div>
            <p className="mt-2 text-xs text-ink-500">
              Expires {new Date(activation.expiresAt).toLocaleString()}. Enter it once on the POS device.
            </p>
          </div>
        ) : null}
      </Glass>

      <Glass variant="data" className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">Device registry</h2>
          <Chip tone="neutral">{data.devices.length} devices</Chip>
        </div>
        {data.devices.length ? (
          data.devices.map((device) => (
            <div key={device.id} className="grid gap-2 border-t border-ink-900/10 py-4 text-sm sm:grid-cols-[1fr_auto]">
              <div>
                <div className="font-semibold">{device.name}</div>
                <div className="text-ink-500">
                  {device.locationName} / {device.registerName}
                </div>
              </div>
              <div className="text-left sm:text-right">
                <Chip
                  tone={device.status === 'active' ? 'success' : device.status === 'pending' ? 'warning' : 'neutral'}
                >
                  {device.status}
                </Chip>
                <div className="mt-2 text-xs text-ink-500">
                  {device.lastSeenAt
                    ? `Last seen ${new Date(device.lastSeenAt).toLocaleString()}`
                    : 'Not activated yet'}
                </div>
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-ink-500">No POS devices registered yet.</p>
        )}
      </Glass>
    </div>
  )
}
