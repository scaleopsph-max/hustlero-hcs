'use client'

import { Button, Field, Glass, Logo } from '@hcs/ui'
import { Mail } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { portalAuth } from '@/lib/portal-api'

/**
 * Email one-time code sign-in. A typed code works inside an installed PWA,
 * where a magic link would open the regular browser instead.
 */
export function SignIn() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const auth = portalAuth()

  async function sendCode(event: FormEvent) {
    event.preventDefault()
    if (!auth) return
    setBusy(true)
    setError(null)
    const { error: sendError } = await auth.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: true },
    })
    setBusy(false)
    if (sendError) setError('Hindi naipadala ang code. I-check ang email at subukan ulit.')
    else setStep('code')
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault()
    if (!auth) return
    setBusy(true)
    setError(null)
    const { error: verifyError } = await auth.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: 'email',
    })
    setBusy(false)
    if (verifyError) setError('Mali o expired na ang code. Humingi ng bagong code.')
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-5 py-10">
      <div className="flex items-center gap-3">
        <Logo size={44} />
        <div>
          <p className="font-display text-h3">Reseller Portal</p>
          <p className="text-small text-ink-300">Order at wholesale price, anytime.</p>
        </div>
      </div>

      <Glass className="rounded-sheet p-6">
        {!auth ? (
          <p className="text-ink-200">Hindi pa naka-configure ang sign-in ng portal na ito.</p>
        ) : step === 'email' ? (
          <form className="flex flex-col gap-5" onSubmit={sendCode}>
            <div>
              <h1 className="text-h3">Mag-sign in</h1>
              <p className="mt-1 text-ink-300">Gamitin ang email na inaprubahan ng business.</p>
            </div>
            <Field
              label="Email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              {...(error ? { error } : {})}
            />
            <Button type="submit" variant="primary" disabled={busy || !email}>
              <Mail size={18} className="mr-2" />
              {busy ? 'Pinapadala…' : 'Ipadala ang code'}
            </Button>
          </form>
        ) : (
          <form className="flex flex-col gap-5" onSubmit={verifyCode}>
            <div>
              <h1 className="text-h3">Ilagay ang code</h1>
              <p className="mt-1 text-ink-300">
                Nagpadala kami ng 6-digit code sa <span className="font-semibold text-ink-50">{email}</span>.
              </p>
            </div>
            <Field
              label="6-digit code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              {...(error ? { error } : {})}
            />
            <Button type="submit" variant="primary" disabled={busy || code.length !== 6}>
              {busy ? 'Chine-check…' : 'Mag-sign in'}
            </Button>
            <button
              type="button"
              className="text-small font-semibold text-gold-300 underline-offset-4 hover:underline"
              onClick={() => {
                setStep('email')
                setCode('')
                setError(null)
              }}
            >
              Ibang email o bagong code
            </button>
          </form>
        )}
      </Glass>
    </div>
  )
}
