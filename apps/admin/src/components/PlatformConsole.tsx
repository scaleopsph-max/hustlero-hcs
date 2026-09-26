'use client'

import { platformContextSchema, type PlatformContext } from '@hcs/contracts'
import { createClient } from '@supabase/supabase-js'
import { Building2, Check, KeyRound, LogOut, RefreshCw, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Chip, Glass, Logo, Surface, cn } from '@hcs/ui'
import { SupportAccessPanel } from './SupportAccessPanel'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''
const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787').replace(/\/$/, '')

type View = 'loading' | 'signed_out' | 'mfa' | 'denied' | 'ready'
type Operation =
  | {
      kind: 'entitlement'
      tenantId: string
      tenantName: string
      featureCode: string
      featureName: string
      grant: boolean
    }
  | { kind: 'status'; tenantId: string; tenantName: string; status: 'active' | 'suspended' }

const authClient = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null

const fieldClass =
  'h-11 w-full rounded-[6px] border border-white/15 bg-black/25 px-3 text-sm text-white outline-none placeholder:text-ink-400 focus:border-gold-400'

export function PlatformConsole() {
  const [auth] = useState(authClient)
  const [view, setView] = useState<View>('loading')
  const [context, setContext] = useState<PlatformContext | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [query, setQuery] = useState('')
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [verificationCode, setVerificationCode] = useState('')
  const [operation, setOperation] = useState<Operation | null>(null)
  const [reason, setReason] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [section, setSection] = useState<'tenants' | 'support'>('tenants')

  const getAccessToken = useCallback(async () => {
    const { data } = (await auth?.auth.getSession()) ?? { data: { session: null } }
    return data.session?.access_token ?? null
  }, [auth])

  const prepareMfa = useCallback(async () => {
    if (!auth) return
    const { data, error } = await auth.auth.mfa.listFactors()
    if (error) return setMessage(error.message)
    const verified = data.totp.find((factor) => factor.status === 'verified')
    if (verified) {
      setFactorId(verified.id)
      setQrCode(null)
      return
    }
    const enrolled = await auth.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'HUSTLERO Super Admin' })
    if (enrolled.error) return setMessage(enrolled.error.message)
    setFactorId(enrolled.data.id)
    setQrCode(enrolled.data.totp.qr_code)
    setSecret(enrolled.data.totp.secret)
  }, [auth])

  const loadContext = useCallback(async () => {
    if (!auth) {
      setMessage('Admin authentication is not configured.')
      setView('signed_out')
      return
    }
    const { data } = await auth.auth.getSession()
    if (!data.session) return setView('signed_out')
    const response = await fetch(`${apiUrl}/v1/platform/context`, {
      headers: { authorization: `Bearer ${data.session.access_token}` },
    })
    const body: unknown = await response.json().catch(() => null)
    if (response.ok) {
      const parsed = platformContextSchema.parse(body)
      setContext(parsed)
      setSelectedTenantId((current) => current ?? parsed.tenants[0]?.id ?? null)
      setView('ready')
      setMessage('')
      return
    }
    const errorCode =
      typeof body === 'object' && body && 'error' in body ? (body.error as { code?: string }).code : null
    if (errorCode === 'MFA_REQUIRED') {
      setView('mfa')
      await prepareMfa()
      return
    }
    if (errorCode === 'PLATFORM_ACCESS_DENIED') return setView('denied')
    setMessage('The platform console could not be loaded. Try again.')
  }, [auth, prepareMfa])

  useEffect(() => {
    void loadContext()
  }, [loadContext])

  async function signIn(event: FormEvent) {
    event.preventDefault()
    if (!auth) return
    setBusy(true)
    setMessage('')
    const { error } = await auth.auth.signInWithPassword({ email, password })
    if (error) setMessage(error.message)
    else await loadContext()
    setBusy(false)
  }

  async function verifyMfa(event: FormEvent) {
    event.preventDefault()
    if (!auth || !factorId) return
    setBusy(true)
    setMessage('')
    const { error } = await auth.auth.mfa.challengeAndVerify({ factorId, code: verificationCode })
    if (error) setMessage(error.message)
    else {
      await auth.auth.refreshSession()
      await loadContext()
    }
    setBusy(false)
  }

  async function signOut() {
    await auth?.auth.signOut()
    setContext(null)
    setView('signed_out')
  }

  async function submitOperation(event: FormEvent) {
    event.preventDefault()
    if (!auth || !operation || reason.trim().length < 3) return
    const { data } = await auth.auth.getSession()
    if (!data.session) return
    setBusy(true)
    setMessage('')
    const isEntitlement = operation.kind === 'entitlement'
    const path = isEntitlement
      ? `/v1/platform/tenants/${operation.tenantId}/entitlements/${operation.featureCode}`
      : `/v1/platform/tenants/${operation.tenantId}/status`
    const body = isEntitlement
      ? {
          entitled: operation.grant,
          endsAt: operation.grant && endsAt ? new Date(`${endsAt}T23:59:59`).toISOString() : null,
          reason: reason.trim(),
        }
      : { status: operation.status, reason: reason.trim() }
    const response = await fetch(`${apiUrl}${path}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${data.session.access_token}`,
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) setMessage(payload?.error?.message ?? 'The platform operation failed.')
    else {
      setOperation(null)
      setReason('')
      setEndsAt('')
      await loadContext()
    }
    setBusy(false)
  }

  const tenants = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!context || !term) return context?.tenants ?? []
    return context.tenants.filter((tenant) => `${tenant.name} ${tenant.slug}`.toLowerCase().includes(term))
  }, [context, query])
  const selectedTenant = context?.tenants.find((tenant) => tenant.id === selectedTenantId) ?? tenants[0] ?? null

  if (view === 'loading')
    return (
      <CenteredPanel title="Opening platform console" detail="Validating the operator session and MFA assurance." />
    )

  if (view === 'signed_out') {
    return (
      <CenteredPanel title="Platform sign in" detail="Use a provisioned operator account. MFA is required.">
        <form className="mt-6 flex w-full max-w-sm flex-col gap-3" onSubmit={signIn}>
          <input
            className={fieldClass}
            type="email"
            autoComplete="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className={fieldClass}
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {message ? <p className="text-sm text-signal-dark-critical-fg">{message}</p> : null}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </CenteredPanel>
    )
  }

  if (view === 'mfa') {
    return (
      <CenteredPanel
        title={qrCode ? 'Set up authenticator' : 'Verify your identity'}
        detail={
          qrCode
            ? 'Scan this code with your authenticator app, then enter the six-digit code.'
            : 'Enter the current six-digit code from your authenticator app.'
        }
      >
        {qrCode ? (
          <img src={qrCode} alt="Authenticator setup QR code" className="mt-5 size-44 rounded-[6px] bg-white p-2" />
        ) : (
          <KeyRound className="mt-5 text-gold-300" size={40} />
        )}
        {secret ? <code className="mt-3 max-w-sm break-all text-xs text-ink-300">{secret}</code> : null}
        <form className="mt-5 flex w-full max-w-sm flex-col gap-3" onSubmit={verifyMfa}>
          <input
            className={fieldClass}
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="000000"
            value={verificationCode}
            onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
            required
          />
          {message ? <p className="text-sm text-signal-dark-critical-fg">{message}</p> : null}
          <Button type="submit" variant="primary" disabled={busy || verificationCode.length !== 6}>
            Verify MFA
          </Button>
        </form>
      </CenteredPanel>
    )
  }

  if (view === 'denied')
    return (
      <CenteredPanel
        title="Platform access not provisioned"
        detail="This signed-in account is not on the platform operator allowlist."
      >
        <Button className="mt-6" onClick={() => void signOut()}>
          <LogOut size={16} /> Sign out
        </Button>
      </CenteredPanel>
    )

  return (
    <Surface tone="dark" className="min-h-screen p-3 text-white sm:p-4">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
        <Glass
          variant="gold"
          role="note"
          className="flex items-start gap-3 rounded-[8px] px-4 py-3 text-sm text-gold-100"
        >
          <ShieldCheck size={20} className="mt-0.5 flex-none" />
          <span>
            Platform operations are isolated from tenant Back Office sessions. Every change requires a reason and is
            audited.
          </span>
        </Glass>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <Logo size={38} />
            <div>
              <h1 className="font-display text-xl font-bold">HCS Platform</h1>
              <p className="text-xs text-ink-300">Tenant operations and entitlements</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Chip tone="success">MFA verified</Chip>
            <span className="hidden text-sm text-ink-200 sm:inline">{context?.admin.displayName}</span>
            <Button size="sm" onClick={() => void signOut()} title="Sign out">
              <LogOut size={16} />
            </Button>
          </div>
        </header>
        <nav className="flex gap-1 border-b border-white/10" aria-label="Platform sections">
          <button
            className={cn(
              'border-b-2 px-4 py-3 text-sm font-semibold',
              section === 'tenants' ? 'border-gold-400 text-gold-200' : 'border-transparent text-ink-300',
            )}
            onClick={() => setSection('tenants')}
          >
            Tenant controls
          </button>
          <button
            className={cn(
              'border-b-2 px-4 py-3 text-sm font-semibold',
              section === 'support' ? 'border-gold-400 text-gold-200' : 'border-transparent text-ink-300',
            )}
            onClick={() => setSection('support')}
          >
            Support access
          </button>
        </nav>
        <section className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', section !== 'tenants' && 'hidden')}>
          <Metric label="Tenants" value={context?.metrics.tenantCount ?? 0} />
          <Metric label="Active" value={context?.metrics.activeTenantCount ?? 0} tone="text-signal-dark-success-fg" />
          <Metric
            label="Suspended"
            value={context?.metrics.suspendedTenantCount ?? 0}
            tone="text-signal-dark-warning-fg"
          />
          <Metric label="Available modules" value={context?.metrics.availableFeatureCount ?? 0} />
        </section>
        {message ? (
          <div className="border-l-2 border-signal-dark-critical-fg bg-signal-dark-critical-bg px-4 py-3 text-sm text-signal-dark-critical-fg">
            {message}
          </div>
        ) : null}
        <div
          className={cn(
            'min-h-[580px] gap-4 lg:grid-cols-[360px_minmax(0,1fr)]',
            section === 'tenants' ? 'grid' : 'hidden',
          )}
        >
          <section className="border-r-0 border-white/10 lg:border-r lg:pr-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Tenants</h2>
              <Button size="sm" onClick={() => void loadContext()} title="Refresh">
                <RefreshCw size={16} />
              </Button>
            </div>
            <label className="mb-3 flex h-10 items-center gap-2 rounded-[6px] border border-white/15 bg-black/20 px-3">
              <Search size={16} className="text-ink-400" />
              <input
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-400"
                placeholder="Search tenants"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="flex flex-col gap-1">
              {tenants.map((tenant) => (
                <button
                  key={tenant.id}
                  onClick={() => setSelectedTenantId(tenant.id)}
                  className={cn(
                    'grid grid-cols-[1fr_auto] gap-2 rounded-[6px] px-3 py-3 text-left hover:bg-white/[0.07]',
                    selectedTenant?.id === tenant.id && 'bg-gold-500/[0.14]',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{tenant.name}</span>
                    <span className="block truncate text-xs text-ink-300">
                      {tenant.slug} · {tenant.locationCount} location{tenant.locationCount === 1 ? '' : 's'}
                    </span>
                  </span>
                  <Chip tone={tenant.status === 'active' ? 'success' : 'warning'}>{tenant.status}</Chip>
                </button>
              ))}
            </div>
          </section>
          <section className="min-w-0">
            {selectedTenant ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <Building2 size={20} className="text-gold-300" />
                      <h2 className="font-display text-xl font-bold">{selectedTenant.name}</h2>
                    </div>
                    <p className="text-sm text-ink-300">
                      {selectedTenant.baseCurrency} · {selectedTenant.timezone} · {selectedTenant.memberCount} active
                      member{selectedTenant.memberCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  {context?.admin.role === 'super_admin' ? (
                    <Button
                      size="sm"
                      variant={selectedTenant.status === 'active' ? 'danger' : 'confirm'}
                      onClick={() =>
                        setOperation({
                          kind: 'status',
                          tenantId: selectedTenant.id,
                          tenantName: selectedTenant.name,
                          status: selectedTenant.status === 'active' ? 'suspended' : 'active',
                        })
                      }
                    >
                      {selectedTenant.status === 'active' ? 'Suspend tenant' : 'Reactivate tenant'}
                    </Button>
                  ) : null}
                </div>
                <div className="mt-5 flex items-center gap-2">
                  <SlidersHorizontal size={18} className="text-gold-300" />
                  <h3 className="font-display text-lg font-bold">Module entitlements</h3>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[620px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-white/15 text-left text-xs uppercase text-ink-300">
                        <th className="py-3 pr-3">Module</th>
                        <th className="px-3 py-3">Platform</th>
                        <th className="px-3 py-3">Entitled</th>
                        <th className="px-3 py-3">Tenant enabled</th>
                        <th className="py-3 pl-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedTenant.entitlements.map((item) => (
                        <tr key={item.featureCode} className="border-b border-white/[0.08]">
                          <td className="py-4 pr-3">
                            <span className="font-semibold">{item.featureName}</span>
                            <span className="block text-xs text-ink-400">
                              {item.featureCode}
                              {item.endsAt ? ` · until ${new Date(item.endsAt).toLocaleDateString()}` : ''}
                            </span>
                          </td>
                          <td className="px-3 py-4">
                            {item.platformAvailable ? (
                              <Check size={18} className="text-signal-dark-success-fg" />
                            ) : (
                              <Chip tone="neutral">Unavailable</Chip>
                            )}
                          </td>
                          <td className="px-3 py-4">
                            <Chip tone={item.entitled ? 'success' : 'neutral'}>
                              {item.entitled ? 'Granted' : 'Not granted'}
                            </Chip>
                          </td>
                          <td className="px-3 py-4">
                            <Chip tone={item.enabled ? 'info' : 'neutral'}>
                              {item.enabled ? 'Enabled' : 'Disabled'}
                            </Chip>
                          </td>
                          <td className="py-4 pl-3 text-right">
                            {context?.admin.canManage && item.platformAvailable ? (
                              <Button
                                size="sm"
                                variant={item.entitled ? 'danger' : 'confirm'}
                                onClick={() =>
                                  setOperation({
                                    kind: 'entitlement',
                                    tenantId: selectedTenant.id,
                                    tenantName: selectedTenant.name,
                                    featureCode: item.featureCode,
                                    featureName: item.featureName,
                                    grant: !item.entitled,
                                  })
                                }
                              >
                                {item.entitled ? 'Revoke' : 'Grant'}
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="py-16 text-center text-ink-300">No tenant selected.</p>
            )}
          </section>
        </div>
        {section === 'support' && context ? (
          <SupportAccessPanel
            tenants={context.tenants}
            canGrant={context.admin.canManage}
            getAccessToken={getAccessToken}
          />
        ) : null}
      </div>
      {operation ? (
        <OperationDialog
          operation={operation}
          busy={busy}
          reason={reason}
          endsAt={endsAt}
          setReason={setReason}
          setEndsAt={setEndsAt}
          close={() => setOperation(null)}
          submit={submitOperation}
        />
      ) : null}
    </Surface>
  )
}

function OperationDialog({
  operation,
  busy,
  reason,
  endsAt,
  setReason,
  setEndsAt,
  close,
  submit,
}: {
  operation: Operation
  busy: boolean
  reason: string
  endsAt: string
  setReason: (value: string) => void
  setEndsAt: (value: string) => void
  close: () => void
  submit: (event: FormEvent) => Promise<void>
}) {
  const destructive = operation.kind === 'status' ? operation.status === 'suspended' : !operation.grant
  const title =
    operation.kind === 'entitlement'
      ? `${operation.grant ? 'Grant' : 'Revoke'} ${operation.featureName}`
      : `${operation.status === 'suspended' ? 'Suspend' : 'Reactivate'} ${operation.tenantName}`
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <Glass variant="strong" className="w-full max-w-lg rounded-[8px] p-5">
        <h2 className="font-display text-xl font-bold">{title}</h2>
        <p className="mt-2 text-sm text-ink-300">
          {destructive
            ? 'Access will stop, but historical business data remains intact.'
            : 'Access will be restored using the existing business records.'}
        </p>
        <form className="mt-5 flex flex-col gap-3" onSubmit={submit}>
          <label className="text-sm font-semibold">
            Reason
            <input
              className={`${fieldClass} mt-1.5`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={240}
              required
            />
          </label>
          {operation.kind === 'entitlement' && operation.grant ? (
            <label className="text-sm font-semibold">
              Expiry date <span className="font-normal text-ink-400">(optional)</span>
              <input
                className={`${fieldClass} mt-1.5`}
                type="date"
                value={endsAt}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </label>
          ) : null}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={destructive ? 'danger' : 'confirm'}
              disabled={busy || reason.trim().length < 3}
            >
              {busy ? 'Applying...' : 'Confirm change'}
            </Button>
          </div>
        </form>
      </Glass>
    </div>
  )
}

function Metric({ label, value, tone = 'text-white' }: { label: string; value: number; tone?: string }) {
  return (
    <Glass className="rounded-[8px] px-4 py-3">
      <span className="text-xs text-ink-300">{label}</span>
      <strong className={cn('mt-1 block font-display text-2xl', tone)}>{value}</strong>
    </Glass>
  )
}

function CenteredPanel({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return (
    <Surface tone="dark" className="grid min-h-screen place-items-center p-4">
      <Glass
        variant="strong"
        className="flex w-full max-w-xl flex-col items-center rounded-[8px] p-8 text-center text-white"
      >
        <Logo size={48} />
        <h1 className="mt-5 font-display text-2xl font-bold">{title}</h1>
        <p className="mt-2 max-w-md text-sm text-ink-300">{detail}</p>
        {children}
      </Glass>
    </Surface>
  )
}
