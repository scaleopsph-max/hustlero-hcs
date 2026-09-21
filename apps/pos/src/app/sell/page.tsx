'use client'

import { LogOut, Minus, Pause, Plus, Receipt, Banknote, ScanLine, Tag, UserPlus } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Button, Chip, Glass, Logo, Surface, buttonClasses, cn, formatPeso } from '@hcs/ui'
import { SyncPill } from '@/components/SyncPill'
import {
  LOW_STOCK_AT,
  categories,
  cartTotal,
  findProduct,
  initialCart,
  products,
  unitPrice,
  wholesaleTriggered,
  type CartLine,
  type Category,
  type PricingMode,
} from '@/mock/pos'

/** POS 2: sell screen (spec section 31: barcode scan, search, categories, quantity, customer, retail/wholesale, hold). */
export default function SellScreen() {
  const [lines, setLines] = useState<CartLine[]>(initialCart)
  const [category, setCategory] = useState<Category | 'All'>('All')
  const [query, setQuery] = useState('')
  // null means automatic: wholesale switches on by itself when the threshold is met.
  const [override, setOverride] = useState<PricingMode | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  const auto = wholesaleTriggered(lines)
  const mode: PricingMode = override ?? (auto ? 'wholesale' : 'retail')
  const total = cartTotal(lines, mode)

  const visible = useMemo(
    () =>
      products.filter(
        (p) =>
          (category === 'All' || p.category === category) &&
          `${p.name} ${p.variant}`.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [category, query],
  )

  function add(productId: string) {
    // TODO: call the pricing engine and the inventory service. Reject when available stock is insufficient (negative stock is blocked by default).
    setLines((ls) =>
      ls.some((l) => l.productId === productId)
        ? ls.map((l) => (l.productId === productId ? { ...l, qty: l.qty + 1 } : l))
        : [...ls, { productId, qty: 1 }],
    )
  }
  function step(productId: string, delta: number) {
    setLines((ls) =>
      ls.map((l) => (l.productId === productId ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0),
    )
  }

  return (
    <Surface
      tone="dark"
      className="flex h-screen min-h-[800px] flex-col gap-3 p-3"
      glows={[
        { color: 'gold', className: 'left-44 top-[300px] size-[520px] opacity-20' },
        { color: 'gray', className: '-right-24 -top-32 size-[520px] opacity-35' },
        { color: 'gold', className: 'right-20 top-[520px] size-[440px] opacity-20' },
      ]}
    >
      <Glass as="header" className="flex h-16 flex-none items-center gap-5 rounded-[20px] px-4">
        <div className="flex flex-none items-center gap-3">
          <Logo size={34} />
          <div className="flex flex-col">
            <span className="text-[15px] font-semibold leading-[18px] text-white">Main Branch</span>
            <span className="text-[13px] leading-4 text-ink-300">Register 1</span>
          </div>
        </div>
        <div className="relative min-w-0 max-w-[380px] flex-1">
          <ScanLine size={20} strokeWidth={1.75} className="absolute left-3.5 top-3 text-ink-300" />
          <label htmlFor="pos-q" className="sr-only">
            Scan barcode or search products
          </label>
          <input
            id="pos-q"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Scan barcode or search products"
            className="h-11 w-full rounded-[14px] border border-white/20 bg-white/[0.08] pl-11 pr-3.5 text-[15px] text-white placeholder:text-ink-300"
          />
        </div>
        <div className="ml-auto flex flex-none items-center gap-2.5">
          <SyncPill status="online" />
          <Button variant="secondary" className="bg-transparent">
            <Receipt size={18} strokeWidth={1.75} className="mr-2" />
            Receipts
          </Button>
          <Button variant="secondary" className="bg-transparent">
            <Banknote size={18} strokeWidth={1.75} className="mr-2" />
            Cash
          </Button>
          <Link href="/close" className={buttonClasses({ variant: 'secondary', className: 'bg-transparent' })}>
            <LogOut size={18} strokeWidth={1.75} className="mr-2" />
            Close register
          </Link>
          <span
            aria-label="Signed in as Ana R."
            className="flex size-10 items-center justify-center rounded-full bg-gold-500 text-sm font-bold text-ink-950"
          >
            AR
          </span>
        </div>
      </Glass>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_400px] gap-3">
        <section className="flex min-w-0 flex-col gap-4 overflow-y-auto py-1">
          <div className="flex flex-wrap gap-2.5">
            {(['All', ...categories] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className={cn(
                  'min-h-touch rounded-full border px-5 text-[15px] font-semibold',
                  category === c
                    ? 'border-ink-50 bg-ink-50 text-ink-950'
                    : 'border-white/20 bg-white/[0.08] text-white',
                )}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {visible.map((p) => {
              const out = p.available <= 0
              const low = !out && p.available <= LOW_STOCK_AT
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={out}
                  onClick={() => add(p.id)}
                  className={cn(
                    'flex min-h-[118px] flex-col justify-between gap-2.5 rounded-glass border p-3.5 text-left backdrop-blur-glass',
                    out
                      ? 'cursor-not-allowed border-white/[0.08] bg-white/[0.03] text-ink-400'
                      : 'border-white/[0.14] bg-white/[0.07] text-white hover:bg-white/[0.12]',
                  )}
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="text-base font-semibold leading-5">{p.name}</span>
                    <span className={cn('text-[13px]', out ? 'text-ink-400' : 'text-ink-300')}>{p.variant}</span>
                  </span>
                  <span className="flex w-full items-center justify-between gap-2">
                    <span
                      className={cn(
                        'font-display text-[22px] font-bold leading-[26px]',
                        out ? 'text-ink-400' : 'text-gold-300',
                      )}
                    >
                      {formatPeso(p.retail)}
                    </span>
                    <Chip tone={out ? 'critical' : low ? 'attention' : 'neutral'}>
                      {out ? 'Out of stock' : `${p.available} left`}
                    </Chip>
                  </span>
                </button>
              )
            })}
          </div>
          {visible.length === 0 ? (
            <p className="text-sm text-ink-200">No product matches. Check the barcode or search by name or SKU.</p>
          ) : null}
        </section>

        <Glass
          variant="strong"
          as="aside"
          className="flex min-h-0 flex-col gap-2.5 overflow-y-auto rounded-[28px] p-3.5"
        >
          <div className="flex items-center justify-between">
            <h1 className="font-display text-[22px] font-bold leading-7 text-white">Current sale</h1>
            <Button variant="secondary">
              <Pause size={18} strokeWidth={1.75} className="mr-2" />
              Hold
            </Button>
          </div>
          <button
            type="button"
            className="flex min-h-touch items-center gap-2.5 rounded-control border border-dashed border-white/35 px-3.5 text-sm font-semibold text-ink-100"
          >
            <UserPlus size={18} strokeWidth={1.75} />
            Add customer
          </button>
          <div className="flex gap-0.5 rounded-[14px] bg-white/[0.08] p-[3px]">
            {(['retail', 'wholesale'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setOverride(m)}
                className={cn(
                  'min-h-touch flex-1 rounded-[11px] text-sm font-semibold',
                  mode === m ? 'bg-ink-50 font-bold text-ink-950' : 'text-ink-200',
                )}
              >
                {m === 'retail' ? 'Retail' : override ? 'Wholesale' : 'Wholesale (auto)'}
              </button>
            ))}
          </div>

          <ul className="flex flex-col">
            {lines.map((l) => {
              const p = findProduct(l.productId)
              const price = unitPrice(p, mode)
              return (
                <li key={l.productId} className="flex items-center gap-2.5 border-b border-white/10 py-2.5">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[15px] font-semibold leading-[19px] text-white">
                      {p.name}, {p.variant}
                    </span>
                    <span className="text-xs leading-4 text-ink-300">
                      {formatPeso(price)} each{price < p.retail ? `, wholesale (was ${formatPeso(p.retail)})` : ''}
                    </span>
                  </div>
                  <div className="flex flex-none items-center">
                    <button
                      type="button"
                      aria-label={`Decrease ${p.name} quantity`}
                      onClick={() => step(l.productId, -1)}
                      className="flex size-11 items-center justify-center rounded-l-control border border-white/20 bg-white/[0.08] text-white"
                    >
                      <Minus size={18} strokeWidth={2} />
                    </button>
                    <span className="flex h-11 w-[38px] items-center justify-center border-y border-white/20 text-base font-bold text-white">
                      {l.qty}
                    </span>
                    <button
                      type="button"
                      aria-label={`Increase ${p.name} quantity`}
                      onClick={() => step(l.productId, 1)}
                      className="flex size-11 items-center justify-center rounded-r-control border border-white/20 bg-white/[0.08] text-white"
                    >
                      <Plus size={18} strokeWidth={2} />
                    </button>
                  </div>
                  <span className="w-[84px] flex-none text-right text-base font-bold text-white">
                    {formatPeso(price * l.qty)}
                  </span>
                </li>
              )
            })}
          </ul>

          {auto && mode === 'wholesale' && !bannerDismissed ? (
            <Glass variant="gold" className="flex flex-col gap-1.5 rounded-[18px] px-3.5 py-3">
              <div className="flex items-center gap-2 text-sm font-bold text-gold-100">
                <Tag size={18} strokeWidth={1.9} />
                Wholesale price applied to Beverages
              </div>
              <p className="text-[13px] leading-[18px] text-ink-50">
                12 items reached the pricing-group threshold. Add a reseller so this price stays on their account.
              </p>
              <div className="flex gap-2">
                <Button variant="confirm">Add reseller</Button>
                <Button
                  variant="secondary"
                  className="border-0 bg-transparent text-gold-100"
                  onClick={() => setBannerDismissed(true)}
                >
                  Not now
                </Button>
              </div>
            </Glass>
          ) : null}

          <div className="mt-auto flex flex-col gap-1">
            <div className="flex justify-between text-sm text-ink-200">
              <span>Subtotal</span>
              <span>{formatPeso(total)}</span>
            </div>
            <div className="flex items-center justify-between text-sm text-ink-200">
              <button type="button" className="min-h-9 text-sm font-semibold text-gold-300 underline">
                Add discount
              </button>
              <span>{formatPeso(0)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-bold text-white">Total</span>
              <span className="font-display text-4xl font-bold leading-10 text-white">{formatPeso(total)}</span>
            </div>
          </div>
          <Link
            href="/checkout"
            className={buttonClasses({ variant: 'primary', size: 'xl', className: 'flex items-center justify-center' })}
          >
            Charge {formatPeso(total)}
          </Link>
        </Glass>
      </div>
    </Surface>
  )
}
