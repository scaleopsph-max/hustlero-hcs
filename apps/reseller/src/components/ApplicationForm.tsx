'use client'

import {
  resellerApplicationRequestSchema,
  resellerApplicationResponseSchema,
  resellerPortalPublicSchema,
  type ResellerPortalPublic,
} from '@hcs/contracts'
import { Button, Field, Glass, Logo, StateCard, Surface } from '@hcs/ui'
import { CircleCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { applyAccent } from '@/lib/branding'
import { fileUrl, portalRequest } from '@/lib/portal-api'

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Public reseller application, opened from a link like /apply?b=<business-slug>. */
export function ApplicationForm() {
  const [slug, setSlug] = useState<string | null>(null)
  const [referralCode, setReferralCode] = useState<string | null>(null)
  const [portal, setPortal] = useState<ResellerPortalPublic | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [form, setForm] = useState({ fullName: '', businessName: '', email: '', phone: '', city: '', message: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [received, setReceived] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const value = params.get('b')?.toLowerCase() ?? ''
    const ref = params.get('ref')?.trim() ?? ''
    if (/^[A-Za-z0-9]{6,12}$/.test(ref)) setReferralCode(ref.toUpperCase())
    if (!slugPattern.test(value)) {
      setUnavailable(true)
      return
    }
    setSlug(value)
    portalRequest(`/v1/public/reseller-portal/${value}`, (data) => resellerPortalPublicSchema.parse(data))
      .then((loaded) => {
        setPortal(loaded)
        applyAccent(loaded.branding?.accentColor)
      })
      .catch(() => setUnavailable(true))
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!slug) return
    const parsed = resellerApplicationRequestSchema.safeParse({
      fullName: form.fullName,
      email: form.email.trim(),
      phone: form.phone,
      ...(form.businessName.trim() ? { businessName: form.businessName } : {}),
      ...(form.city.trim() ? { city: form.city } : {}),
      ...(form.message.trim() ? { message: form.message } : {}),
      ...(referralCode ? { referralCode } : {}),
    })
    if (!parsed.success) {
      setError('Check your name, email, and mobile number (e.g. 09171234567).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await portalRequest(
        `/v1/public/reseller-portal/${slug}/applications`,
        (data) => resellerApplicationResponseSchema.parse(data),
        {
          method: 'POST',
          body: parsed.data,
        },
      )
      setReceived(true)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Not sent. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }))

  return (
    <Surface
      tone="dark"
      glows={[{ color: 'gold', className: '-right-40 -top-40 size-[420px] opacity-20' }]}
      className="min-h-dvh"
    >
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-10">
        <div className="flex items-center gap-3">
          {portal?.branding?.logoUrl ? (
            <img
              src={fileUrl(portal.branding.logoUrl)}
              alt=""
              className="size-11 flex-none rounded-[14px] object-cover"
            />
          ) : (
            <Logo size={44} />
          )}
          <div>
            <p className="font-display text-h3">Become a reseller</p>
            {portal ? (
              <p className="text-small text-ink-300">{portal.branding?.portalName ?? portal.businessName}</p>
            ) : null}
          </div>
        </div>

        {unavailable ? (
          <StateCard
            kind="locked"
            title="Application form unavailable"
            why="We could not find this business. Check the link you were given."
          />
        ) : !portal ? (
          <p className="text-ink-300" role="status">
            Loading…
          </p>
        ) : !portal.applicationsOpen ? (
          <StateCard
            kind="locked"
            title="Applications are closed"
            why={`${portal.businessName} is not accepting new resellers right now. Please try again later.`}
          />
        ) : received ? (
          <Glass className="flex flex-col items-center gap-4 rounded-sheet px-6 py-10 text-center">
            <CircleCheck size={48} className="text-signal-dark-success-fg" />
            <p className="text-h3">Application received</p>
            <p className="text-ink-200">
              {portal.businessName} will review it. Once approved, sign in to the portal with {form.email.trim()}.
            </p>
          </Glass>
        ) : (
          <Glass className="rounded-sheet p-6">
            <form className="flex flex-col gap-4" onSubmit={submit}>
              {referralCode ? (
                <p className="rounded-control bg-white/10 px-3 py-2 text-small text-ink-200">
                  Invited with referral code <span className="font-mono font-semibold">{referralCode}</span>
                </p>
              ) : null}
              <Field label="Full name" autoComplete="name" required value={form.fullName} onChange={set('fullName')} />
              <Field
                label="Store name (optional)"
                autoComplete="organization"
                value={form.businessName}
                onChange={set('businessName')}
              />
              <Field
                label="Email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={form.email}
                onChange={set('email')}
                hint="You will use this email to sign in."
              />
              <Field
                label="Mobile number"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                required
                value={form.phone}
                onChange={set('phone')}
              />
              <Field label="City (optional)" autoComplete="address-level2" value={form.city} onChange={set('city')} />
              <label className="flex flex-col gap-2">
                <span className="text-sm font-semibold">Message (optional)</span>
                <textarea
                  className="field h-auto min-h-24 py-3"
                  maxLength={1000}
                  value={form.message}
                  onChange={set('message')}
                />
              </label>
              {error ? <p className="text-small text-signal-dark-critical-fg">{error}</p> : null}
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Sending…' : 'Send application'}
              </Button>
            </form>
          </Glass>
        )}
      </div>
    </Surface>
  )
}
