'use client'

import type { ResellerPortalAvailability } from '@hcs/contracts'
import { Button, Glass } from '@hcs/ui'
import { Lock, Power, Store } from 'lucide-react'
import { useState } from 'react'

/** Shown while the portal is off: the owner turns it on; everyone else sees what is needed. */
export function PortalActivation({
  availability,
  busy,
  onEnable,
}: {
  availability: ResellerPortalAvailability
  busy: boolean
  onEnable: () => void
}) {
  const { entitled, advancedWholesaleEnabled, canToggle } = availability
  return (
    <Glass variant="light" className="mx-6 flex max-w-2xl flex-col gap-4 rounded-panel p-6">
      <span className="flex size-12 items-center justify-center rounded-full bg-gold-500/15 text-gold-700">
        {entitled ? <Store size={24} /> : <Lock size={24} />}
      </span>
      <div>
        <h2 className="font-display text-xl font-bold">
          {entitled ? 'The reseller portal is off' : 'The reseller portal is not in your plan'}
        </h2>
        <p className="mt-1 text-sm text-ink-600">
          {!entitled
            ? 'Contact HUSTLERO to add the reseller portal to this business.'
            : !advancedWholesaleEnabled
              ? 'The portal uses Advanced wholesale for prices, credit, and invoices. Turn on Advanced wholesale in Settings first.'
              : canToggle
                ? 'Turn it on to let resellers apply, order at their wholesale prices, pay by GCash or bank, and track deliveries.'
                : 'Ask the business owner to turn it on.'}
        </p>
      </div>
      {entitled && advancedWholesaleEnabled && canToggle ? (
        <Button variant="confirm" className="self-start" disabled={busy} onClick={onEnable}>
          <Power size={16} className="mr-2" />
          {busy ? 'Turning on…' : 'Turn on the reseller portal'}
        </Button>
      ) : null}
    </Glass>
  )
}

/** Owner-only switch at the bottom of Settings. Asks once before turning the portal off. */
export function PortalOffSwitch({ busy, onDisable }: { busy: boolean; onDisable: () => void }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <Glass variant="data" className="flex flex-col gap-3 rounded-panel p-5">
      <div>
        <h3 className="font-semibold">Turn off the reseller portal</h3>
        <p className="text-sm text-ink-500">
          Resellers can no longer sign in, apply, or order. Orders already placed, invoices, and payments stay as they
          are, and you can turn it back on any time.
        </p>
      </div>
      {confirming ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" disabled={busy} onClick={onDisable}>
            {busy ? 'Turning off…' : 'Yes, turn it off'}
          </Button>
          <Button disabled={busy} onClick={() => setConfirming(false)}>
            Keep it on
          </Button>
        </div>
      ) : (
        <Button className="self-start" disabled={busy} onClick={() => setConfirming(true)}>
          <Power size={16} className="mr-2" />
          Turn off
        </Button>
      )}
    </Glass>
  )
}
