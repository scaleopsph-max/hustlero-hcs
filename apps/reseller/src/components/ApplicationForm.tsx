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

import { portalRequest } from '@/lib/portal-api'

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Public reseller application, opened from a link like /apply?b=<business-slug>. */
export function ApplicationForm() {
  const [slug, setSlug] = useState<string | null>(null)
  const [portal, setPortal] = useState<ResellerPortalPublic | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [form, setForm] = useState({ fullName: '', businessName: '', email: '', phone: '', city: '', message: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [received, setReceived] = useState(false)

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('b')?.toLowerCase() ?? ''
    if (!slugPattern.test(value)) {
      setUnavailable(true)
      return
    }
    setSlug(value)
    portalRequest(`/v1/public/reseller-portal/${value}`, (data) => resellerPortalPublicSchema.parse(data))
      .then(setPortal)
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
    })
    if (!parsed.success) {
      setError('I-check ang pangalan, email, at mobile number (hal. 09171234567).')
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
      setError(submitError instanceof Error ? submitError.message : 'Hindi naipadala. Subukan ulit.')
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
          <Logo size={44} />
          <div>
            <p className="font-display text-h3">Maging reseller</p>
            {portal ? <p className="text-small text-ink-300">{portal.businessName}</p> : null}
          </div>
        </div>

        {unavailable ? (
          <StateCard
            kind="locked"
            title="Hindi available ang application form"
            why="Hindi namin mahanap ang business na ito. I-check ang link na ibinigay sa iyo."
          />
        ) : !portal ? (
          <p className="text-ink-300" role="status">
            Naglo-load…
          </p>
        ) : !portal.applicationsOpen ? (
          <StateCard
            kind="locked"
            title="Sarado muna ang applications"
            why={`Hindi tumatanggap ng bagong reseller ang ${portal.businessName} sa ngayon. Subukan ulit sa susunod.`}
          />
        ) : received ? (
          <Glass className="flex flex-col items-center gap-4 rounded-sheet px-6 py-10 text-center">
            <CircleCheck size={48} className="text-signal-dark-success-fg" />
            <p className="text-h3">Natanggap ang application mo</p>
            <p className="text-ink-200">
              Ire-review ito ng {portal.businessName}. Kapag na-approve, mag-sign in sa portal gamit ang{' '}
              {form.email.trim()}.
            </p>
          </Glass>
        ) : (
          <Glass className="rounded-sheet p-6">
            <form className="flex flex-col gap-4" onSubmit={submit}>
              <Field
                label="Buong pangalan"
                autoComplete="name"
                required
                value={form.fullName}
                onChange={set('fullName')}
              />
              <Field
                label="Pangalan ng tindahan (optional)"
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
                hint="Ito ang gagamitin mo sa pag-sign in."
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
                <span className="text-sm font-semibold">Mensahe (optional)</span>
                <textarea
                  className="field h-auto min-h-24 py-3"
                  maxLength={1000}
                  value={form.message}
                  onChange={set('message')}
                />
              </label>
              {error ? <p className="text-small text-signal-dark-critical-fg">{error}</p> : null}
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Pinapadala…' : 'Ipadala ang application'}
              </Button>
            </form>
          </Glass>
        )}
      </div>
    </Surface>
  )
}
