'use client'

import { ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button, Glass, Keypad, Logo, Surface, cn } from '@hcs/ui'
import { SyncPill } from '@/components/SyncPill'

const PIN_MAX = 6
const PIN_MIN = 4

/** POS 1: employee PIN sign-in on a registered device (spec section 6, 10.1). */
export default function PosSignIn() {
  const router = useRouter()
  const [pin, setPin] = useState('')

  function onKey(key: string) {
    if (key === 'clear') return setPin('')
    if (key === 'back') return setPin((p) => p.slice(0, -1))
    setPin((p) => (p.length < PIN_MAX ? p + key : p))
  }

  function signIn() {
    // TODO: POST /auth/pos/pin with the device id. Tenant, location and register come from the
    // registered device, never from the client. On success route to Open Register, then Sell.
    router.push('/sell')
  }

  return (
    <Surface
      tone="dark"
      className="flex min-h-screen"
      glows={[
        { color: 'gold', className: 'left-[620px] top-20 size-[560px] opacity-35' },
        { color: 'gray', className: '-left-40 top-[300px] size-[520px] opacity-35' },
        { color: 'gold', className: 'left-[200px] -top-40 size-[420px] opacity-15' },
      ]}
    >
      <section className="flex w-1/2 flex-col p-14">
        <div className="flex items-center gap-3">
          <Logo size={40} />
          <span className="font-display text-[21px] font-bold text-white">HUSTLERO POS</span>
        </div>
        <div className="my-auto flex flex-col gap-2.5">
          <span className="font-display text-[84px] font-bold leading-[84px] tracking-tight text-white">
            Main Branch
          </span>
          <span className="font-display text-4xl font-semibold text-gold-300">Register 1</span>
          <span className="mt-3.5 text-xl text-ink-200">Sunday, 20 September 2026</span>
        </div>
        <div className="flex flex-col gap-5">
          <Glass className="flex flex-col gap-1 rounded-glass px-5 py-4">
            <span className="text-[17px] font-bold text-white">Register 1 is closed.</span>
            <span className="text-[15px] leading-[22px] text-ink-200">
              Sign in, then open it with your starting cash.
            </span>
          </Glass>
          <div className="self-start">
            <SyncPill status="online" />
          </div>
        </div>
      </section>

      <section className="flex w-1/2 items-center justify-center">
        <Glass variant="strong" className="flex w-[440px] flex-col gap-[22px] rounded-[32px] p-9">
          <div className="flex items-center gap-2 text-[13px] text-ink-200">
            <ShieldCheck size={18} strokeWidth={1.9} className="text-gold-300" />
            <span>Registered device for Main Branch, Register 1</span>
          </div>
          <h1 className="font-display text-[32px] font-bold leading-9 text-white">Enter your PIN</h1>
          <div
            role="img"
            aria-label={`${pin.length} of ${PIN_MAX} digits entered`}
            className="flex justify-center gap-3.5"
          >
            {Array.from({ length: PIN_MAX }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'size-4 rounded-full border-2',
                  i < pin.length ? 'border-gold-500 bg-gold-500' : 'border-white/45',
                )}
              />
            ))}
          </div>
          <Keypad mode="pin" onKey={onKey} />
          <Button variant="primary" size="xl" disabled={pin.length < PIN_MIN} onClick={signIn}>
            Sign in
          </Button>
          <p className="text-center text-[13px] leading-[19px] text-ink-300">
            A manager PIN is asked only for sensitive actions, like refunds and voids.
          </p>
        </Glass>
      </section>
    </Surface>
  )
}
