'use client'

import { pushPublicKeyResponseSchema, pushSubscriptionResponseSchema } from '@hcs/contracts'
import { Button, Glass, disablePush, enablePush, pushState, pushSupport, useToast, type PushState } from '@hcs/ui'
import { BellOff, BellRing, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'

type Status = PushState | 'unsupported' | 'ios-needs-install' | 'not-configured' | 'loading'

/** Opt-in for push alerts on this device: new portal payments to verify, orders to review, applications. */
export function PushAlerts({ request }: { request: (path: string, init?: RequestInit) => Promise<unknown> }) {
  const toast = useToast()
  const [status, setStatus] = useState<Status>('loading')
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const support = pushSupport()
    if (support !== 'supported') {
      setStatus(support)
      return
    }
    void request('/v1/push/public-key')
      .then(async (value) => {
        const key = pushPublicKeyResponseSchema.parse(value).publicKey
        setPublicKey(key)
        setStatus(key ? await pushState() : 'not-configured')
      })
      .catch(() => setStatus('not-configured'))
  }, [request])

  async function turnOn() {
    if (!publicKey) return
    setBusy(true)
    try {
      const next = await enablePush('/sw-push.js', publicKey, async (subscription) =>
        pushSubscriptionResponseSchema.parse(
          await request('/v1/push-subscriptions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(subscription),
          }),
        ),
      )
      setStatus(next)
      if (next === 'on') toast.success('Push alerts are on for this device.')
      else if (next === 'blocked') toast.error('Notifications are blocked. Allow them in your browser settings.')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Push alerts could not be turned on.')
    } finally {
      setBusy(false)
    }
  }

  async function turnOff() {
    setBusy(true)
    try {
      setStatus(
        await disablePush((endpoint) =>
          request('/v1/push-subscriptions/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint }),
          }),
        ),
      )
      toast.success('Push alerts are off for this device.')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Push alerts could not be turned off.')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading' || status === 'unsupported' || status === 'not-configured') return null
  return (
    <Glass variant="light" className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex size-9 flex-none items-center justify-center rounded-full bg-gold-500/15 text-gold-700">
          {status === 'on' ? (
            <BellRing size={18} />
          ) : status === 'blocked' ? (
            <BellOff size={18} />
          ) : (
            <Smartphone size={18} />
          )}
        </span>
        <div className="min-w-0">
          <p className="font-semibold">
            {status === 'on'
              ? 'Push alerts are on for this device'
              : status === 'blocked'
                ? 'Notifications are blocked on this device'
                : 'Get push alerts on this device'}
          </p>
          <p className="text-sm text-ink-500">
            {status === 'ios-needs-install'
              ? 'On iPhone or iPad, add the Back Office to your Home Screen first (Share, then Add to Home Screen).'
              : status === 'blocked'
                ? 'Allow notifications for this site in your browser settings, then reload this page.'
                : 'Reseller payments to verify, portal orders to review, and new reseller applications, even when this tab is closed.'}
          </p>
        </div>
      </div>
      {status === 'on' ? (
        <Button size="sm" disabled={busy} onClick={() => void turnOff()}>
          {busy ? 'Turning off…' : 'Turn off'}
        </Button>
      ) : status === 'off' ? (
        <Button size="sm" variant="confirm" disabled={busy} onClick={() => void turnOn()}>
          {busy ? 'Turning on…' : 'Turn on push alerts'}
        </Button>
      ) : null}
    </Glass>
  )
}
