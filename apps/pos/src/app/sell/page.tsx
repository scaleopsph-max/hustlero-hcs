'use client'

import { Banknote, LogOut, Minus, Plus, ScanLine, ShoppingBag } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { posRegisterOpenResponseSchema, posSalesContextSchema, type PosSalesContext } from '@hcs/contracts'
import { Button, Chip, Glass, Logo, Surface, buttonClasses, cn, formatPeso, parsePeso } from '@hcs/ui'
import { SyncPill } from '@/components/SyncPill'
import {
  POS_SESSION_KEY,
  newIdempotencyKey,
  posRequest,
  readPosCart,
  readPosSession,
  writePosCart,
  type PosCartLine,
} from '@/lib/pos-api'

export default function SellScreen() {
  const router = useRouter()
  const [context, setContext] = useState<PosSalesContext | null>(null)
  const [lines, setLines] = useState<PosCartLine[]>([])
  const [category, setCategory] = useState('All')
  const [query, setQuery] = useState('')
  const [openingCash, setOpeningCash] = useState('0.00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (!readPosSession()) return router.replace('/')
    try {
      setContext(posSalesContextSchema.parse(await posRequest('/v1/pos/context')))
      setLines(readPosCart())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the register.')
      if (!readPosSession()) router.replace('/')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const itemById = useMemo(() => new Map(context?.items.map((item) => [item.variantId, item]) ?? []), [context])
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (context?.items ?? []).filter(
      (item) =>
        (category === 'All' || item.category === category) &&
        (!needle ||
          `${item.productName} ${item.variantName} ${item.sku} ${item.barcode ?? ''}`.toLowerCase().includes(needle)),
    )
  }, [category, context, query])
  const total = lines.reduce(
    (sum, line) => sum + (itemById.get(line.variantId)?.retailPriceCentavos ?? 0) * (line.quantityMilli / 1000),
    0,
  )

  function updateLines(next: PosCartLine[]) {
    setLines(next)
    writePosCart(next)
  }

  function add(variantId: string) {
    const item = itemById.get(variantId)
    if (!item) return
    const current = lines.find((line) => line.variantId === variantId)?.quantityMilli ?? 0
    if (item.availableMilli !== null && current + 1000 > item.availableMilli) {
      setError(`Only ${item.availableMilli / 1000} ${item.productName} available.`)
      return
    }
    setError(null)
    updateLines(
      lines.some((line) => line.variantId === variantId)
        ? lines.map((line) =>
            line.variantId === variantId ? { ...line, quantityMilli: line.quantityMilli + 1000 } : line,
          )
        : [...lines, { variantId, quantityMilli: 1000 }],
    )
  }

  function step(variantId: string, delta: number) {
    const next = lines
      .map((line) =>
        line.variantId === variantId ? { ...line, quantityMilli: line.quantityMilli + delta * 1000 } : line,
      )
      .filter((line) => line.quantityMilli > 0)
    const changed = next.find((line) => line.variantId === variantId)
    const available = itemById.get(variantId)?.availableMilli
    if (changed && available !== null && available !== undefined && changed.quantityMilli > available) return
    updateLines(next)
  }

  async function openRegister() {
    setBusy(true)
    setError(null)
    try {
      posRegisterOpenResponseSchema.parse(
        await posRequest('/v1/pos/register-sessions/open', {
          method: 'POST',
          headers: { 'Idempotency-Key': newIdempotencyKey('register_open') },
          body: JSON.stringify({ openingCashCentavos: parsePeso(openingCash) }),
        }),
      )
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open the register.')
      if (!readPosSession()) router.replace('/')
    } finally {
      setBusy(false)
    }
  }

  function signOut() {
    sessionStorage.removeItem(POS_SESSION_KEY)
    router.replace('/')
  }

  if (!context)
    return (
      <Surface tone="dark" className="grid min-h-screen place-items-center p-6">
        <p className="text-ink-100">{error ?? 'Loading register...'}</p>
      </Surface>
    )

  return (
    <Surface tone="dark" className="flex min-h-screen flex-col gap-3 p-3">
      <Glass as="header" className="flex min-h-16 flex-wrap items-center gap-4 rounded-[20px] px-4 py-2">
        <Logo size={34} />
        <div className="mr-2">
          <div className="font-semibold text-white">{context.device.locationName}</div>
          <div className="text-sm text-ink-300">{context.device.registerName}</div>
        </div>
        <div className="relative min-w-[240px] max-w-[520px] flex-1">
          <ScanLine size={20} className="absolute left-3.5 top-3 text-ink-300" />
          <input
            aria-label="Scan barcode or search products"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Scan barcode, name or SKU"
            className="h-11 w-full rounded-[14px] border border-white/20 bg-white/[0.08] pl-11 pr-4 text-white placeholder:text-ink-300"
          />
        </div>
        <SyncPill status="online" />
        <span className="text-sm font-semibold text-white">{context.employee.displayName}</span>
        <Button variant="secondary" className="bg-transparent" onClick={signOut}>
          <LogOut size={18} className="mr-2" />
          Sign out
        </Button>
      </Glass>

      {error ? <div className="border-l-2 border-red-400 bg-red-950/60 p-3 text-sm text-red-100">{error}</div> : null}

      {!context.registerSession ? (
        <div className="grid flex-1 place-items-center p-4">
          <Glass variant="strong" className="flex w-full max-w-[520px] flex-col gap-5 rounded-[28px] p-7">
            <Banknote size={30} className="text-gold-300" />
            <div>
              <h1 className="font-display text-3xl font-bold text-white">Open {context.device.registerName}</h1>
              <p className="mt-2 text-ink-200">Count the cash drawer before the first sale.</p>
            </div>
            <label className="grid gap-2 text-sm font-semibold text-white">
              Starting cash
              <input
                value={openingCash}
                onChange={(event) => setOpeningCash(event.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                className="h-16 border-2 border-gold-500 bg-white/[0.08] px-4 font-display text-3xl font-bold text-white"
              />
            </label>
            <Button variant="primary" size="xl" disabled={busy} onClick={() => void openRegister()}>
              {busy ? 'Opening...' : `Open register with ${formatPeso(parsePeso(openingCash))}`}
            </Button>
          </Glass>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_400px]">
          <section className="flex min-w-0 flex-col gap-4 overflow-y-auto py-1">
            <div className="flex flex-wrap gap-2">
              {['All', ...context.categories].map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setCategory(name)}
                  className={cn(
                    'min-h-11 rounded-full border px-5 text-sm font-semibold',
                    category === name
                      ? 'border-white bg-white text-ink-950'
                      : 'border-white/20 bg-white/[0.08] text-white',
                  )}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {visible.map((item) => {
                const unavailable = item.availableMilli !== null && item.availableMilli < 1000
                return (
                  <button
                    key={item.variantId}
                    type="button"
                    disabled={unavailable}
                    onClick={() => add(item.variantId)}
                    className={cn(
                      'flex min-h-[126px] flex-col justify-between border p-3.5 text-left',
                      unavailable
                        ? 'border-white/10 bg-white/[0.03] text-ink-400'
                        : 'border-white/[0.14] bg-white/[0.07] text-white hover:bg-white/[0.12]',
                    )}
                  >
                    <span>
                      <span className="block font-semibold">{item.productName}</span>
                      <span className="text-sm text-ink-300">
                        {item.variantName} · {item.sku}
                      </span>
                    </span>
                    <span className="flex items-end justify-between gap-2">
                      <strong className="font-display text-xl text-gold-300">
                        {formatPeso(item.retailPriceCentavos)}
                      </strong>
                      <Chip tone={unavailable ? 'critical' : 'neutral'}>
                        {item.availableMilli === null ? 'Available' : `${item.availableMilli / 1000} left`}
                      </Chip>
                    </span>
                  </button>
                )
              })}
            </div>
            {!visible.length ? <p className="text-sm text-ink-200">No matching active product variants.</p> : null}
          </section>

          <Glass variant="strong" as="aside" className="flex min-h-[520px] flex-col gap-3 rounded-[28px] p-4">
            <div className="flex items-center justify-between">
              <h1 className="font-display text-[22px] font-bold text-white">Current sale</h1>
              <ShoppingBag size={21} className="text-gold-300" />
            </div>
            <ul className="flex flex-col overflow-y-auto">
              {lines.map((line) => {
                const item = itemById.get(line.variantId)
                if (!item) return null
                return (
                  <li key={line.variantId} className="flex items-center gap-2 border-b border-white/10 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-white">
                        {item.productName}, {item.variantName}
                      </div>
                      <div className="text-xs text-ink-300">{formatPeso(item.retailPriceCentavos)} each</div>
                    </div>
                    <div className="flex items-center">
                      <button
                        aria-label="Decrease quantity"
                        onClick={() => step(line.variantId, -1)}
                        className="grid size-10 place-items-center border border-white/20 text-white"
                      >
                        <Minus size={17} />
                      </button>
                      <span className="grid h-10 w-9 place-items-center border-y border-white/20 font-bold text-white">
                        {line.quantityMilli / 1000}
                      </span>
                      <button
                        aria-label="Increase quantity"
                        onClick={() => step(line.variantId, 1)}
                        className="grid size-10 place-items-center border border-white/20 text-white"
                      >
                        <Plus size={17} />
                      </button>
                    </div>
                    <strong className="w-20 text-right text-white">
                      {formatPeso((item.retailPriceCentavos * line.quantityMilli) / 1000)}
                    </strong>
                  </li>
                )
              })}
            </ul>
            {!lines.length ? (
              <div className="grid flex-1 place-items-center text-center text-sm text-ink-300">
                Select a product to start the sale.
              </div>
            ) : null}
            <div className="mt-auto flex items-baseline justify-between">
              <span className="text-lg font-bold text-white">Total</span>
              <span className="font-display text-4xl font-bold text-white">{formatPeso(total)}</span>
            </div>
            <button
              disabled={!lines.length}
              onClick={() => router.push('/checkout')}
              className={buttonClasses({
                variant: 'primary',
                size: 'xl',
                className: 'disabled:cursor-not-allowed disabled:opacity-40',
              })}
            >
              Charge {formatPeso(total)}
            </button>
          </Glass>
        </div>
      )}
    </Surface>
  )
}
