'use client'

import { createClient } from '@supabase/supabase-js'
import { CircleDollarSign, LockKeyhole, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  paymentMethodCreateResponseSchema,
  registerOperationsContextSchema,
  registerSessionCloseResponseSchema,
  registerSessionOpenResponseSchema,
  sessionContextResponseSchema,
  type RegisterOperationsContext,
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

function toCentavos(value: string) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Enter a valid non-negative cash amount.')
  return Math.round(amount * 100)
}

function peso(centavos: number | null) {
  if (centavos === null) return '-'
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(centavos / 100)
}

export function RegisterOperationsWorkspace({ focus }: { focus: 'payments' | 'sessions' }) {
  const [auth] = useState(() => (supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null))
  const [token, setToken] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [data, setData] = useState<RegisterOperationsContext>({
    paymentMethods: [],
    employees: [],
    registers: [],
    recentSessions: [],
  })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [methodCode, setMethodCode] = useState('qr_ph')
  const [methodName, setMethodName] = useState('QR Ph')
  const [methodType, setMethodType] = useState<'cash' | 'e_wallet' | 'bank_transfer' | 'card_terminal' | 'other'>(
    'e_wallet',
  )
  const [registerId, setRegisterId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [openingCash, setOpeningCash] = useState('0.00')
  const [closingSessionId, setClosingSessionId] = useState('')
  const [countedCash, setCountedCash] = useState('0.00')

  const load = useCallback(async (nextToken: string, nextTenant: string) => {
    const next = registerOperationsContextSchema.parse(await call('/v1/register-operations', nextToken, nextTenant))
    setData(next)
    const availableRegister = next.registers.find(
      (register) => register.status === 'active' && !register.currentSession,
    )
    setRegisterId((value) => value || availableRegister?.id || '')
    setClosingSessionId(
      (value) => value || next.registers.find((register) => register.currentSession)?.currentSession?.id || '',
    )
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
        if (!sessionData.session) throw new Error('Sign in to manage register operations.')
        const nextToken = sessionData.session.access_token
        const session = sessionContextResponseSchema.parse(await call('/v1/me', nextToken, ''))
        const tenant = session.tenants.find((entry) => entry.isOwner) ?? session.tenants[0]
        if (!tenant) throw new Error('Create a business first.')
        setToken(nextToken)
        setTenantId(tenant.tenantId)
        await load(nextToken, tenant.tenantId)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load register operations.')
      } finally {
        setLoading(false)
      }
    })
  }, [auth, load])

  const selectedRegister = data.registers.find((register) => register.id === registerId)
  const eligibleEmployees = useMemo(
    () =>
      data.employees.filter(
        (employee) => selectedRegister && employee.locationIds.includes(selectedRegister.locationId),
      ),
    [data.employees, selectedRegister],
  )
  useEffect(() => {
    setEmployeeId((value) =>
      eligibleEmployees.some((employee) => employee.id === value) ? value : eligibleEmployees[0]?.id || '',
    )
  }, [eligibleEmployees])

  async function submit(path: string, body: unknown, parse: (value: unknown) => unknown, success: string) {
    if (!token || !tenantId) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      parse(
        await call(path, token, tenantId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `register-${crypto.randomUUID()}` },
          body: JSON.stringify(body),
        }),
      )
      await load(token, tenantId)
      setMessage(success)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save register operation.')
    } finally {
      setBusy(false)
    }
  }

  const createPaymentMethod = (event: FormEvent) => {
    event.preventDefault()
    void submit(
      '/v1/payment-methods',
      { code: methodCode, name: methodName, methodType },
      paymentMethodCreateResponseSchema.parse,
      'Payment method created.',
    )
  }
  const openSession = (event: FormEvent) => {
    event.preventDefault()
    try {
      void submit(
        '/v1/register-sessions/open',
        { registerId, employeeId, openingCashCentavos: toCentavos(openingCash) },
        registerSessionOpenResponseSchema.parse,
        'Register session opened.',
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invalid opening cash.')
    }
  }
  const closeSession = (event: FormEvent) => {
    event.preventDefault()
    try {
      void submit(
        `/v1/register-sessions/${closingSessionId}/close`,
        { countedCashCentavos: toCentavos(countedCash) },
        registerSessionCloseResponseSchema.parse,
        'Register session closed and reconciled.',
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invalid counted cash.')
    }
  }

  if (loading)
    return (
      <Glass variant="light" className="p-8 text-sm text-ink-500">
        Loading register operations...
      </Glass>
    )

  const availableRegisters = data.registers.filter(
    (register) => register.status === 'active' && !register.currentSession,
  )
  const openSessions = data.registers.flatMap((register) => (register.currentSession ? [register.currentSession] : []))

  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      {error ? (
        <div className="border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-700 xl:col-span-2">{error}</div>
      ) : null}
      {message ? (
        <div className="border-l-2 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-800 xl:col-span-2">
          {message}
        </div>
      ) : null}
      <Glass variant="light" className="p-5">
        {focus === 'payments' ? (
          <form className="grid gap-3" onSubmit={createPaymentMethod}>
            <div className="mb-1 flex items-center gap-3">
              <CircleDollarSign size={22} />
              <h2 className="font-display text-xl font-bold">Add payment method</h2>
            </div>
            <input
              className={control}
              value={methodCode}
              onChange={(event) => setMethodCode(event.target.value)}
              placeholder="Code"
              required
            />
            <input
              className={control}
              value={methodName}
              onChange={(event) => setMethodName(event.target.value)}
              placeholder="Display name"
              required
            />
            <select
              className={control}
              value={methodType}
              onChange={(event) => setMethodType(event.target.value as typeof methodType)}
            >
              <option value="cash">Cash</option>
              <option value="e_wallet">E-wallet</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="card_terminal">Card terminal</option>
              <option value="other">Other</option>
            </select>
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              <Plus size={16} className="mr-2" />
              Add method
            </Button>
          </form>
        ) : (
          <div className="grid gap-7">
            <form className="grid gap-3" onSubmit={openSession}>
              <h2 className="font-display text-xl font-bold">Open register</h2>
              <select
                className={control}
                value={registerId}
                onChange={(event) => setRegisterId(event.target.value)}
                required
              >
                {!availableRegisters.length ? <option value="">No available registers</option> : null}
                {availableRegisters.map((register) => (
                  <option key={register.id} value={register.id}>
                    {register.locationName} / {register.name}
                  </option>
                ))}
              </select>
              <select
                className={control}
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
                required
              >
                {!eligibleEmployees.length ? <option value="">No assigned employees</option> : null}
                {eligibleEmployees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.displayName} ({employee.employeeCode})
                  </option>
                ))}
              </select>
              <input
                className={control}
                type="number"
                min="0"
                step="0.01"
                value={openingCash}
                onChange={(event) => setOpeningCash(event.target.value)}
                aria-label="Opening cash"
                required
              />
              <Button type="submit" variant="primary" size="sm" disabled={busy || !registerId || !employeeId}>
                <Plus size={16} className="mr-2" />
                Open session
              </Button>
            </form>
            <form className="grid gap-3 border-t border-ink-900/10 pt-6" onSubmit={closeSession}>
              <h2 className="font-display text-xl font-bold">Close register</h2>
              <select
                className={control}
                value={closingSessionId}
                onChange={(event) => setClosingSessionId(event.target.value)}
                required
              >
                {!openSessions.length ? <option value="">No open sessions</option> : null}
                {data.registers
                  .filter((register) => register.currentSession)
                  .map((register) => (
                    <option key={register.currentSession!.id} value={register.currentSession!.id}>
                      {register.locationName} / {register.name}
                    </option>
                  ))}
              </select>
              <input
                className={control}
                type="number"
                min="0"
                step="0.01"
                value={countedCash}
                onChange={(event) => setCountedCash(event.target.value)}
                aria-label="Counted cash"
                required
              />
              <Button type="submit" variant="secondary" size="sm" disabled={busy || !closingSessionId}>
                <LockKeyhole size={16} className="mr-2" />
                Close and reconcile
              </Button>
            </form>
          </div>
        )}
      </Glass>
      <Glass variant="data" className="p-5">
        {focus === 'payments' ? (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-xl font-bold">Accepted payments</h2>
              <Chip tone="neutral">{data.paymentMethods.filter((method) => method.isActive).length} active</Chip>
            </div>
            {data.paymentMethods.map((method) => (
              <div
                key={method.id}
                className="flex items-center justify-between border-t border-ink-900/10 py-3 text-sm"
              >
                <div>
                  <div className="font-semibold">{method.name}</div>
                  <div className="text-ink-500">
                    {method.code} / {method.methodType.replace('_', ' ')}
                  </div>
                </div>
                <Chip tone={method.isActive ? 'success' : 'neutral'}>{method.isActive ? 'Active' : 'Inactive'}</Chip>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-xl font-bold">Session history</h2>
              <Chip tone={openSessions.length ? 'warning' : 'neutral'}>{openSessions.length} open</Chip>
            </div>
            {data.recentSessions.length ? (
              data.recentSessions.map((session) => (
                <div
                  key={session.id}
                  className="grid gap-2 border-t border-ink-900/10 py-4 text-sm sm:grid-cols-[1fr_auto]"
                >
                  <div>
                    <div className="font-semibold">
                      {session.registerName} / {session.employeeName}
                    </div>
                    <div className="text-ink-500">
                      {session.locationName} / Opened {new Date(session.openedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <Chip
                      tone={
                        session.status === 'open' ? 'warning' : session.status === 'closed' ? 'success' : 'critical'
                      }
                    >
                      {session.status}
                    </Chip>
                    <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-1 text-xs sm:min-w-64">
                      <dt className="text-ink-500">Opening</dt>
                      <dd className="font-medium text-ink-900">{peso(session.openingCashCentavos)}</dd>
                      {session.expectedCashCentavos !== null ? (
                        <>
                          <dt className="text-ink-500">Expected</dt>
                          <dd className="font-medium text-ink-900">{peso(session.expectedCashCentavos)}</dd>
                        </>
                      ) : null}
                      {session.countedCashCentavos !== null ? (
                        <>
                          <dt className="text-ink-500">Counted</dt>
                          <dd className="font-medium text-ink-900">{peso(session.countedCashCentavos)}</dd>
                        </>
                      ) : null}
                      {session.varianceCentavos !== null ? (
                        <>
                          <dt className="text-ink-500">Variance</dt>
                          <dd
                            className={
                              session.varianceCentavos === 0
                                ? 'font-semibold text-emerald-700'
                                : 'font-semibold text-red-700'
                            }
                          >
                            {peso(session.varianceCentavos)}
                            {session.varianceCentavos === 0 ? ' · Balanced' : ''}
                          </dd>
                        </>
                      ) : null}
                    </dl>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-ink-500">No register sessions yet.</p>
            )}
          </>
        )}
      </Glass>
    </div>
  )
}
