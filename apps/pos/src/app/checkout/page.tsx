'use client'

import { Banknote, CreditCard, Smartphone, Split, type LucideIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button, Glass, Keypad, Surface, cn, formatPeso, parsePeso } from '@hcs/ui'
import { SubHeader } from '@/components/SubHeader'
import { cartTotal, initialCart, wholesaleTriggered, findProduct } from '@/mock/pos'

type Method = 'cash' | 'ewallet' | 'card' | 'split'
const methods: { id: Method; label: string; Icon: LucideIcon }[] = [
  { id: 'cash', label: 'Cash', Icon: Banknote },
  { id: 'ewallet', label: 'E-wallet', Icon: Smartphone },
  { id: 'card', label: 'Card', Icon: CreditCard },
  { id: 'split', label: 'Split payment', Icon: Split },
]

/** POS 3: checkout (spec section 31: cash, e-wallet, card, split, receipt). */
export default function Checkout() {
  const router = useRouter()
  // MOCK: the real cart comes from shared cart state (see docs/HANDOFF.md, "Open items").
  const mode = wholesaleTriggered(initialCart) ? 'wholesale' : 'retail'
  const total = cartTotal(initialCart, mode)

  const [method, setMethod] = useState<Method>('cash')
  const [received, setReceived] = useState('2000.00')
  const [print, setPrint] = useState(true)

  const receivedC = parsePeso(received)
  const change = Math.max(0, receivedC - total)
  const enough = receivedC >= total

  function onKey(key: string) {
    if (key === 'back') return setReceived((r) => r.slice(0, -1))
    if (key === 'clear') return setReceived('')
    if (key === '.' && received.includes('.')) return
    setReceived((r) => (r.length < 9 ? r + key : r))
  }

  function complete() {
    // TODO: POST /sales with an idempotency key generated when this screen opened (spec section 36).
    // The sale, payment and stock movement are one atomic transaction. If payment status is unknown,
    // look it up by idempotency key. Never show "failed" for an unknown status (spec section 27.2).
    router.push('/sell')
  }

  const quick = [
    { label: `Exact ${formatPeso(total)}`, value: total },
    { label: formatPeso(200000), value: 200000 },
    { label: formatPeso(250000), value: 250000 },
    { label: formatPeso(300000), value: 300000 },
  ]

  return (
    <Surface
      tone="dark"
      className="flex h-screen min-h-[800px] flex-col gap-3 p-3"
      glows={[
        { color: 'gold', className: 'left-[500px] top-[120px] size-[560px] opacity-25' },
        { color: 'gray', className: '-left-40 top-[400px] size-[480px] opacity-35' },
        { color: 'gray', className: '-right-28 -top-24 size-[440px] opacity-30' },
      ]}
    >
      <SubHeader
        backHref="/sell"
        backLabel="Back to sale"
        title="Payment"
        right={<span className="text-[13px] text-ink-300">Main Branch, Register 1, Ana R.</span>}
      />

      <div className="grid min-h-0 flex-1 grid-cols-[380px_minmax(0,1fr)] gap-3">
        <Glass variant="strong" as="aside" className="flex flex-col gap-4 rounded-[28px] p-6">
          <h2 className="font-display text-[22px] font-bold leading-7 text-white">Order summary</h2>
          <ul className="flex flex-col">
            {initialCart.map((l) => {
              const p = findProduct(l.productId)
              const unit = mode === 'wholesale' ? p.wholesale : p.retail
              return (
                <li key={l.productId} className="flex justify-between gap-3 border-t border-white/[0.12] py-3.5">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[15px] font-semibold text-white">
                      {p.name}, {p.variant}
                    </span>
                    <span className="text-[13px] text-ink-300">
                      {l.qty} × {formatPeso(unit)}
                      {unit < p.retail ? ', wholesale' : ''}
                    </span>
                  </div>
                  <span className="text-[15px] font-bold text-white">{formatPeso(unit * l.qty)}</span>
                </li>
              )
            })}
          </ul>
          <dl className="flex flex-col gap-1.5 border-t border-white/[0.12] pt-3.5 text-sm text-ink-200">
            <div className="flex justify-between">
              <dt>Pricing</dt>
              <dd>{mode === 'wholesale' ? 'Wholesale, applied automatically' : 'Retail'}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Customer</dt>
              <dd>Walk-in</dd>
            </div>
            <div className="flex justify-between">
              <dt>Discounts</dt>
              <dd>{formatPeso(0)}</dd>
            </div>
          </dl>
          <div className="mt-auto flex items-baseline justify-between">
            <span className="text-lg font-bold text-white">Total due</span>
            <span className="font-display text-4xl font-bold leading-10 text-white">{formatPeso(total)}</span>
          </div>
        </Glass>

        <section className="flex min-w-0 flex-col gap-5 px-1 py-1">
          <div className="grid grid-cols-4 gap-3">
            {methods.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={method === id}
                onClick={() => setMethod(id)}
                className={cn(
                  'flex h-[88px] flex-col items-center justify-center gap-2 rounded-[22px] border text-base font-semibold backdrop-blur-glass',
                  method === id
                    ? 'border-gold-500/60 bg-gold-500/[0.18] text-gold-100'
                    : 'border-white/[0.14] bg-white/[0.07] text-white',
                )}
              >
                <Icon size={28} strokeWidth={1.75} />
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-start gap-6">
            <div className="flex min-w-0 flex-1 flex-col gap-3.5">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-ink-300">Amount due</span>
                <span className="font-display text-[44px] font-bold leading-[48px] tracking-tight text-white">
                  {formatPeso(total)}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pos-cash" className="text-sm font-semibold text-ink-50">
                  Cash received
                </label>
                <input
                  id="pos-cash"
                  inputMode="decimal"
                  value={received}
                  onChange={(e) => setReceived(e.target.value.replace(/[^0-9.]/g, ''))}
                  className="h-16 rounded-[18px] border-2 border-gold-500 bg-white/[0.08] px-[18px] font-display text-[34px] font-bold text-white"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {quick.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => setReceived((q.value / 100).toFixed(2))}
                    className={cn(
                      'min-h-12 rounded-[14px] border px-4 text-[15px] font-semibold',
                      receivedC === q.value
                        ? 'border-gold-500/60 bg-gold-500/[0.18] text-gold-100'
                        : 'border-white/20 bg-white/[0.08] text-white',
                    )}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              <Glass className="flex items-baseline justify-between rounded-[18px] px-[18px] py-3.5" role="status">
                <span className="text-base font-semibold text-ink-100">{enough ? 'Change due' : 'Still needed'}</span>
                <span className="font-display text-[34px] font-bold leading-[38px] text-gold-300">
                  {formatPeso(enough ? change : total - receivedC)}
                </span>
              </Glass>
            </div>
            <Keypad mode="amount" onKey={onKey} className="w-[330px] flex-none gap-2.5" />
          </div>

          <div className="mt-auto flex flex-col gap-3.5">
            <div className="flex items-center gap-8">
              <label className="flex min-h-touch items-center gap-2.5 text-[15px] font-semibold text-white">
                <input
                  type="checkbox"
                  checked={print}
                  onChange={(e) => setPrint(e.target.checked)}
                  className="size-[22px] accent-gold-500"
                />
                Print receipt
              </label>
              <label className="flex min-h-touch items-center gap-2.5 text-[15px] font-semibold text-ink-300">
                <input type="checkbox" disabled className="size-[22px]" />
                Email receipt
              </label>
              <span className="text-[13px] text-ink-300">Add a customer to email a receipt.</span>
            </div>
            <Button variant="primary" size="xl" disabled={!enough} onClick={complete}>
              Complete sale
            </Button>
          </div>
        </section>
      </div>
    </Surface>
  )
}
