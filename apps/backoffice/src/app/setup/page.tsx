'use client'

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { ArrowRight, Check, Circle, Loader2, LogOut, Store } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  onboardingResponseSchema,
  sessionContextResponseSchema,
  tenantBootstrapResponseSchema,
  type OnboardingResponse,
} from '@hcs/contracts'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const apiUrl = process.env.NEXT_PUBLIC_API_URL

const stepLabels: Record<OnboardingResponse['steps'][number]['code'], string> = {
  business: 'Business',
  main_location: 'Main location',
  business_questions: 'Business setup questions',
  feature_selection: 'Feature selection',
  products: 'Products',
  opening_inventory: 'Opening inventory',
  payment_methods: 'Payment methods',
  basic_fund_setup: 'Basic fund setup',
  employees: 'Employees',
  register: 'Register',
  pos_activation: 'POS activation',
  test_sale: 'Guided test sale',
}

type Business = { tenantId: string; tenantName: string; isOwner: boolean }

function client(): SupabaseClient | null {
  return supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null
}

async function apiRequest(path: string, accessToken: string, options?: RequestInit) {
  if (!apiUrl) throw new Error('Back Office API URL is not configured.')

  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, ...options?.headers },
  })
  const data: unknown = await response.json()
  if (!response.ok) {
    const error = data as { error?: { message?: string } }
    throw new Error(error.error?.message ?? 'The request could not be completed.')
  }
  return data
}

export default function SetupPage() {
  const [auth] = useState(client)
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-up')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null)
  const [onboarding, setOnboarding] = useState<OnboardingResponse | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [locationName, setLocationName] = useState('Main Store')
  const [locationCode, setLocationCode] = useState('MAIN')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadBusinesses = useCallback(async (accessToken: string) => {
    const data = sessionContextResponseSchema.parse(await apiRequest('/v1/me', accessToken))
    const owned = data.tenants.filter((item) => item.isOwner)
    setBusinesses(owned)
    setSelectedTenantId((current) =>
      current && owned.some((item) => item.tenantId === current) ? current : (owned[0]?.tenantId ?? null),
    )
  }, [])

  useEffect(() => {
    if (!auth) {
      setLoading(false)
      return
    }

    const { data: listener } = auth.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setToken(session?.access_token ?? null)
      if (!session) {
        setBusinesses([])
        setSelectedTenantId(null)
        setOnboarding(null)
      }
      setLoading(false)
    })

    void auth.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) setError(sessionError.message)
      setUser(data.session?.user ?? null)
      setToken(data.session?.access_token ?? null)
      setLoading(false)
    })

    return () => listener.subscription.unsubscribe()
  }, [auth])

  useEffect(() => {
    if (!token) return
    void loadBusinesses(token).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not load businesses.'),
    )
  }, [token, loadBusinesses])

  useEffect(() => {
    if (!token || !selectedTenantId) {
      setOnboarding(null)
      return
    }
    void apiRequest('/v1/onboarding', token, { headers: { 'X-Tenant-Id': selectedTenantId } })
      .then((data) => setOnboarding(onboardingResponseSchema.parse(data)))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load setup status.'))
  }, [token, selectedTenantId])

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!auth) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (mode === 'sign-up') {
        const { data, error: authError } = await auth.auth.signUp({ email, password })
        if (authError) throw authError
        if (!data.session) setNotice('Check your email to confirm your account, then sign in.')
      } else {
        const { error: authError } = await auth.auth.signInWithPassword({ email, password })
        if (authError) throw authError
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authentication failed.')
    } finally {
      setBusy(false)
    }
  }

  async function createBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || !user) return
    setBusy(true)
    setError(null)
    const body = {
      name: name.trim(),
      slug: slug.trim().toLowerCase(),
      baseCurrency: 'PHP',
      timezone: 'Asia/Manila',
      mainLocation: { code: locationCode.trim(), name: locationName.trim() },
    }
    const storageKey = `hcs:onboarding:${user.id}:${body.slug}`
    const serialized = JSON.stringify(body)
    try {
      const previous = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as { body?: string; key?: string } | null
      const key = previous?.body === serialized && previous.key ? previous.key : crypto.randomUUID()
      localStorage.setItem(storageKey, JSON.stringify({ body: serialized, key }))
      const data = tenantBootstrapResponseSchema.parse(
        await apiRequest('/v1/tenants', token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
          body: serialized,
        }),
      )
      await loadBusinesses(token)
      setSelectedTenantId(data.tenantId)
      setNotice('Business and main location created.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Business creation failed.')
    } finally {
      setBusy(false)
    }
  }

  const inputClass =
    'min-h-11 w-full rounded-md border border-ink-900/15 bg-white px-3 text-sm outline-none focus:border-ink-900'
  const buttonClass =
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink-900 px-5 text-sm font-semibold text-white disabled:opacity-50'

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 pb-16 pt-6 sm:px-8">
      <header className="flex items-center justify-between border-b border-ink-900/10 pb-5">
        <div className="flex items-center gap-3">
          <Store size={25} />
          <span className="font-display text-xl font-bold">HUSTLERO</span>
          <span className="text-sm text-ink-500">Business setup</span>
        </div>
        {user && auth ? (
          <button
            type="button"
            onClick={() => void auth.auth.signOut()}
            className="inline-flex items-center gap-2 text-sm font-medium"
          >
            <LogOut size={17} />
            Sign out
          </button>
        ) : null}
      </header>

      <div className="grid gap-10 pt-10 md:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.9fr)]">
        <section className="min-w-0">
          {loading ? (
            <div className="flex items-center gap-2 text-sm">
              <Loader2 size={18} className="animate-spin" />
              Loading account
            </div>
          ) : null}
          {!auth || !apiUrl ? (
            <p role="alert" className="text-sm text-red-700">
              Setup is unavailable until the Back Office public environment variables are configured.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mb-5 border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="mb-5 border-l-2 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-900">
              {notice}
            </p>
          ) : null}

          {!loading && !user && auth ? (
            <>
              <h1 className="font-display text-3xl font-bold">
                {mode === 'sign-up' ? 'Create your account' : 'Welcome back'}
              </h1>
              <form onSubmit={(event) => void submitAuth(event)} className="mt-7 flex max-w-md flex-col gap-4">
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Email
                  <input
                    className={inputClass}
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Password
                  <input
                    className={inputClass}
                    type="password"
                    autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                    minLength={6}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                <button type="submit" disabled={busy} className={buttonClass}>
                  {busy ? <Loader2 size={18} className="animate-spin" /> : null}
                  {mode === 'sign-up' ? 'Create account' : 'Sign in'}
                  <ArrowRight size={17} />
                </button>
              </form>
              <button
                type="button"
                className="mt-5 text-sm font-semibold underline"
                onClick={() => {
                  setMode(mode === 'sign-up' ? 'sign-in' : 'sign-up')
                  setError(null)
                }}
              >
                {mode === 'sign-up' ? 'Already have an account? Sign in' : 'New to HUSTLERO? Create an account'}
              </button>
            </>
          ) : null}

          {user && !selectedTenantId ? (
            <>
              <h1 className="font-display text-3xl font-bold">Create your business</h1>
              <p className="mt-2 text-sm text-ink-500">
                Start with one main location. More branches can be added later.
              </p>
              <form
                onSubmit={(event) => void createBusiness(event)}
                className="mt-7 grid max-w-xl gap-4 sm:grid-cols-2"
              >
                <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
                  Business name
                  <input
                    className={inputClass}
                    required
                    minLength={2}
                    maxLength={120}
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value)
                      if (!slug)
                        setSlug(
                          event.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, '-')
                            .replace(/^-|-$/g, ''),
                        )
                    }}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
                  Business URL identifier
                  <input
                    className={inputClass}
                    required
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    maxLength={60}
                    value={slug}
                    onChange={(event) => setSlug(event.target.value.toLowerCase())}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Main location name
                  <input
                    className={inputClass}
                    required
                    minLength={2}
                    maxLength={120}
                    value={locationName}
                    onChange={(event) => setLocationName(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Location code
                  <input
                    className={inputClass}
                    required
                    maxLength={24}
                    value={locationCode}
                    onChange={(event) => setLocationCode(event.target.value)}
                  />
                </label>
                <div className="sm:col-span-2">
                  <button type="submit" disabled={busy} className={buttonClass}>
                    {busy ? <Loader2 size={18} className="animate-spin" /> : null}Create business
                    <ArrowRight size={17} />
                  </button>
                </div>
              </form>
            </>
          ) : null}

          {user && selectedTenantId ? (
            <>
              <h1 className="font-display text-3xl font-bold">
                {businesses.find((item) => item.tenantId === selectedTenantId)?.tenantName ?? 'Business setup'}
              </h1>
              <p className="mt-2 text-sm text-ink-500">
                Your business is saved. Continue setup as each step becomes available.
              </p>
              {businesses.length > 1 ? (
                <label className="mt-6 flex max-w-sm flex-col gap-1.5 text-sm font-medium">
                  Business
                  <select
                    className={inputClass}
                    value={selectedTenantId}
                    onChange={(event) => setSelectedTenantId(event.target.value)}
                  >
                    {businesses.map((item) => (
                      <option key={item.tenantId} value={item.tenantId}>
                        {item.tenantName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="mt-8 border-t border-ink-900/10 pt-6">
                <h2 className="font-display text-lg font-bold">Setup progress</h2>
                {onboarding ? (
                  <ol className="mt-4 grid gap-x-8 gap-y-0 sm:grid-cols-2">
                    {onboarding.steps.map((step) => (
                      <li
                        key={step.code}
                        className="flex min-h-12 items-center gap-3 border-b border-ink-900/10 text-sm"
                      >
                        <span className={step.status === 'complete' ? 'text-emerald-700' : 'text-ink-400'}>
                          {step.status === 'complete' ? <Check size={18} /> : <Circle size={18} />}
                        </span>
                        <span className="flex-1">{stepLabels[step.code]}</span>
                        <span className="text-xs text-ink-500">
                          {step.status === 'complete' ? 'Complete' : 'Pending'}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-4 text-sm text-ink-500">Loading setup progress...</p>
                )}
              </div>
            </>
          ) : null}
        </section>
        <aside className="border-t border-ink-900/10 pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
          <p className="text-xs font-semibold uppercase text-ink-500">Current status</p>
          <p className="mt-2 font-display text-xl font-bold">
            {onboarding?.readyToSell ? 'Ready to Sell' : selectedTenantId ? 'Setup in progress' : 'Account setup'}
          </p>
          <p className="mt-3 text-sm leading-6 text-ink-500">
            {selectedTenantId
              ? 'Products, stock, payments, register and a test sale are still required before POS can go live.'
              : 'Create your account, business and first location to begin.'}
          </p>
        </aside>
      </div>
    </div>
  )
}
