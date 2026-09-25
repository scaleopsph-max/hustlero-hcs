'use client'

import { KeyRound, RotateCcw, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import {
  posDeviceActivateResponseSchema,
  posPinLoginResponseSchema,
  type PosDeviceActivateRequest,
  type PosPinLoginRequest,
} from '@hcs/contracts'
import { Button, Glass, Keypad, Logo, Surface, cn } from '@hcs/ui'
import { SyncPill } from '@/components/SyncPill'

const apiUrl = process.env.NEXT_PUBLIC_API_URL
const DEVICE_KEY = 'hustlero.pos.device'
const SESSION_KEY = 'hustlero.pos.session'
const PIN_MAX = 6
const PIN_MIN = 4

type RegisteredDevice = {
  deviceToken: string
  device: {
    id: string
    name: string
    tenantName: string
    locationId: string
    locationName: string
    registerId: string
    registerName: string
  }
}

async function post(path: string, body: PosDeviceActivateRequest | PosPinLoginRequest, deviceToken?: string) {
  if (!apiUrl) throw new Error('POS API URL is not configured.')
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(deviceToken ? { 'X-POS-Device-Token': deviceToken } : {}),
    },
    body: JSON.stringify(body),
  })
  const data: unknown = await response.json()
  if (!response.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? 'Request failed.')
  return data
}

export default function PosSignIn() {
  const router = useRouter()
  const [device, setDevice] = useState<RegisteredDevice | null>(null)
  const [ready, setReady] = useState(false)
  const [activationCode, setActivationCode] = useState('')
  const [employeeCode, setEmployeeCode] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem(DEVICE_KEY)
    if (stored) {
      try {
        setDevice(posDeviceActivateResponseSchema.parse(JSON.parse(stored)))
      } catch {
        localStorage.removeItem(DEVICE_KEY)
      }
    }
    setReady(true)
  }, [])

  function onKey(key: string) {
    if (key === 'clear') return setPin('')
    if (key === 'back') return setPin((current) => current.slice(0, -1))
    setPin((current) => (current.length < PIN_MAX ? current + key : current))
  }

  async function activate(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const activated = posDeviceActivateResponseSchema.parse(
        await post('/v1/pos/devices/activate', { activationCode: activationCode.trim().toUpperCase() }),
      )
      localStorage.setItem(DEVICE_KEY, JSON.stringify(activated))
      setDevice(activated)
      setActivationCode('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not activate this device.')
    } finally {
      setBusy(false)
    }
  }

  async function signIn() {
    if (!device) return
    setBusy(true)
    setError(null)
    try {
      const session = posPinLoginResponseSchema.parse(
        await post('/v1/pos/sessions/pin-login', { employeeCode, pin }, device.deviceToken),
      )
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
      router.push('/sell')
    } catch (cause) {
      setPin('')
      setError(cause instanceof Error ? cause.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  function resetDevice() {
    localStorage.removeItem(DEVICE_KEY)
    sessionStorage.removeItem(SESSION_KEY)
    setDevice(null)
    setPin('')
    setError(null)
  }

  const date = new Intl.DateTimeFormat('en-PH', { dateStyle: 'full' }).format(new Date())
  const locationName = device?.device.locationName ?? 'Unregistered device'
  const registerName = device?.device.registerName ?? 'Activation required'

  return (
    <Surface
      tone="dark"
      className="flex min-h-screen flex-col lg:flex-row"
      glows={[
        { color: 'gold', className: 'left-[46%] top-20 size-[560px] opacity-35' },
        { color: 'gray', className: '-left-40 top-[300px] size-[520px] opacity-35' },
      ]}
    >
      <section className="flex min-h-[36vh] flex-1 flex-col p-7 sm:p-10 lg:min-h-screen lg:p-14">
        <div className="flex items-center gap-3">
          <Logo size={40} />
          <span className="font-display text-[21px] font-bold text-white">HUSTLERO POS</span>
        </div>
        <div className="my-auto flex flex-col gap-2.5 py-10">
          <span className="font-display text-5xl font-bold leading-none text-white sm:text-6xl lg:text-[72px]">
            {locationName}
          </span>
          <span className="font-display text-3xl font-semibold text-gold-300">{registerName}</span>
          <span className="mt-3.5 text-lg text-ink-200">{date}</span>
        </div>
        <div className="flex items-end justify-between gap-4">
          <SyncPill status="online" />
          {device ? (
            <button
              type="button"
              title="Reset device registration"
              aria-label="Reset device registration"
              className="grid size-11 place-items-center border border-white/15 bg-white/[0.06] text-ink-200 hover:text-white"
              onClick={resetDevice}
            >
              <RotateCcw size={18} />
            </button>
          ) : null}
        </div>
      </section>

      <section className="flex flex-1 items-center justify-center p-5 sm:p-8">
        <Glass variant="strong" className="flex w-full max-w-[440px] flex-col gap-[22px] rounded-[32px] p-7 sm:p-9">
          {!ready ? (
            <p className="text-sm text-ink-200">Checking device registration...</p>
          ) : device ? (
            <>
              <div className="flex items-center gap-2 text-[13px] text-ink-200">
                <ShieldCheck size={18} strokeWidth={1.9} className="text-gold-300" />
                <span>
                  {device.device.tenantName} / {device.device.name}
                </span>
              </div>
              <h1 className="font-display text-[32px] font-bold leading-9 text-white">Employee sign in</h1>
              {error ? (
                <div className="border-l-2 border-red-400 bg-red-950/40 p-3 text-sm text-red-100">{error}</div>
              ) : null}
              <label className="grid gap-2 text-sm font-medium text-ink-100">
                Employee code
                <input
                  className="h-12 border border-white/20 bg-white/10 px-4 text-base text-white outline-none focus:border-gold-400"
                  value={employeeCode}
                  onChange={(event) => setEmployeeCode(event.target.value)}
                  autoComplete="username"
                  autoCapitalize="characters"
                  required
                />
              </label>
              <div
                role="img"
                aria-label={`${pin.length} of ${PIN_MAX} digits entered`}
                className="flex justify-center gap-3.5"
              >
                {Array.from({ length: PIN_MAX }, (_, index) => (
                  <span
                    key={index}
                    className={cn(
                      'size-4 rounded-full border-2',
                      index < pin.length ? 'border-gold-500 bg-gold-500' : 'border-white/45',
                    )}
                  />
                ))}
              </div>
              <Keypad mode="pin" onKey={onKey} />
              <Button
                variant="primary"
                size="xl"
                disabled={busy || !employeeCode.trim() || pin.length < PIN_MIN}
                onClick={() => void signIn()}
              >
                Sign in
              </Button>
            </>
          ) : (
            <form className="flex flex-col gap-5" onSubmit={activate}>
              <div className="flex items-center gap-2 text-[13px] text-ink-200">
                <KeyRound size={18} strokeWidth={1.9} className="text-gold-300" />
                <span>Secure device registration</span>
              </div>
              <h1 className="font-display text-[32px] font-bold leading-9 text-white">Activate this POS</h1>
              {error ? (
                <div className="border-l-2 border-red-400 bg-red-950/40 p-3 text-sm text-red-100">{error}</div>
              ) : null}
              <label className="grid gap-2 text-sm font-medium text-ink-100">
                Activation code
                <input
                  className="h-14 border border-white/20 bg-white/10 px-4 text-center font-display text-xl font-bold uppercase tracking-widest text-white outline-none focus:border-gold-400"
                  value={activationCode}
                  onChange={(event) => setActivationCode(event.target.value.replace(/[^a-fA-F0-9]/g, '').slice(0, 12))}
                  autoComplete="one-time-code"
                  maxLength={12}
                  required
                />
              </label>
              <Button variant="primary" size="xl" type="submit" disabled={busy || activationCode.length !== 12}>
                Activate device
              </Button>
              <p className="text-center text-[13px] leading-[19px] text-ink-300">
                Get the one-time code from Back Office under POS devices.
              </p>
            </form>
          )}
        </Glass>
      </section>
    </Surface>
  )
}
