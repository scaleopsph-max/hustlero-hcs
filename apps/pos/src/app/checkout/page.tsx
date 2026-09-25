'use client'

import { Banknote, CheckCircle2, CreditCard, Smartphone } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import {
  posCashSaleCompleteResponseSchema,
  posSalesContextSchema,
  type PosCustomer,
  type PosCashSaleCompleteResponse,
  type PosSalesContext,
} from '@hcs/contracts'
import { Button, Glass, Keypad, Surface, cn, formatPeso, parsePeso } from '@hcs/ui'
import { SubHeader } from '@/components/SubHeader'
import {
  POS_CART_KEY,
  POS_CUSTOMER_KEY,
  newIdempotencyKey,
  posRequest,
  readPosCart,
  readPosCustomer,
  readPosSession,
  type PosCartLine,
} from '@/lib/pos-api'

export default function Checkout() {
  const router = useRouter()
  const [context, setContext] = useState<PosSalesContext | null>(null)
  const [lines, setLines] = useState<PosCartLine[]>([])
  const [customer, setCustomer] = useState<PosCustomer | null>(null)
  const [received, setReceived] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<PosCashSaleCompleteResponse | null>(null)
  const idempotencyKey = useMemo(() => newIdempotencyKey('cash_sale'), [])

  useEffect(() => {
    if (!readPosSession()) return router.replace('/')
    const cart = readPosCart()
    if (!cart.length) return router.replace('/sell')
    setLines(cart)
    setCustomer(readPosCustomer())
    void posRequest('/v1/pos/context')
      .then((data) => {
        const loaded = posSalesContextSchema.parse(data)
        if (!loaded.registerSession) return router.replace('/sell')
        setContext(loaded)
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : 'Could not load checkout.')
        if (!readPosSession()) router.replace('/')
      })
  }, [router])

  const itemById = useMemo(() => new Map(context?.items.map((item) => [item.variantId, item]) ?? []), [context])
  const total = lines.reduce(
    (sum, line) => sum + (itemById.get(line.variantId)?.retailPriceCentavos ?? 0) * (line.quantityMilli / 1000),
    0,
  )
  const receivedCentavos = parsePeso(received)
  const enough = receivedCentavos >= total && total > 0

  function onKey(key: string) {
    if (key === 'back') return setReceived((value) => value.slice(0, -1))
    if (key === 'clear') return setReceived('')
    if (key === '.' && received.includes('.')) return
    setReceived((value) => (value.length < 10 ? value + key : value))
  }

  async function complete() {
    setBusy(true)
    setError(null)
    try {
      const completed = posCashSaleCompleteResponseSchema.parse(
        await posRequest('/v1/pos/sales/complete', {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({ lines, cashReceivedCentavos: receivedCentavos, customerId: customer?.id ?? null }),
        }),
      )
      sessionStorage.removeItem(POS_CART_KEY)
      sessionStorage.removeItem(POS_CUSTOMER_KEY)
      setReceipt(completed)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The sale could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  if (receipt)
    return (
      <Surface tone="dark" className="grid min-h-screen place-items-center p-6">
        <Glass
          variant="strong"
          className="flex w-full max-w-[520px] flex-col items-center gap-5 rounded-[28px] p-8 text-center"
        >
          <CheckCircle2 size={54} className="text-emerald-400" />
          <div>
            <div className="text-sm font-semibold uppercase text-ink-300">Sale completed</div>
            <h1 className="mt-1 font-display text-3xl font-bold text-white">{receipt.receiptNumber}</h1>
          </div>
          <dl className="grid w-full grid-cols-2 gap-3 border-y border-white/10 py-5 text-left">
            <dt className="text-ink-300">Total</dt>
            <dd className="text-right font-bold text-white">{formatPeso(receipt.totalCentavos)}</dd>
            <dt className="text-ink-300">Cash received</dt>
            <dd className="text-right font-bold text-white">{formatPeso(receipt.cashReceivedCentavos)}</dd>
            <dt className="text-ink-300">Change</dt>
            <dd className="text-right font-display text-2xl font-bold text-gold-300">
              {formatPeso(receipt.changeCentavos)}
            </dd>
          </dl>
          <Button variant="primary" size="xl" className="w-full" onClick={() => router.replace('/sell')}>
            New sale
          </Button>
        </Glass>
      </Surface>
    )

  if (!context)
    return (
      <Surface tone="dark" className="grid min-h-screen place-items-center p-6">
        <p className="text-ink-100">{error ?? 'Loading checkout...'}</p>
      </Surface>
    )

  return (
    <Surface tone="dark" className="flex min-h-screen flex-col gap-3 p-3">
      <SubHeader
        backHref="/sell"
        backLabel="Back to sale"
        title="Cash payment"
        right={
          <span className="text-[13px] text-ink-300">
            {context.device.locationName}, {context.device.registerName}, {context.employee.displayName}
          </span>
        }
      />
      {error ? <div className="border-l-2 border-red-400 bg-red-950/60 p-3 text-sm text-red-100">{error}</div> : null}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Glass variant="strong" as="aside" className="flex flex-col gap-4 rounded-[28px] p-6">
          <h2 className="font-display text-[22px] font-bold text-white">Order summary</h2>
          {customer ? (
            <div className="border-y border-white/10 py-3 text-sm">
              <span className="text-ink-300">Customer</span>
              <strong className="float-right text-white">{customer.fullName}</strong>
            </div>
          ) : null}
          <ul>
            {lines.map((line) => {
              const item = itemById.get(line.variantId)
              return item ? (
                <li key={line.variantId} className="flex justify-between gap-3 border-t border-white/10 py-3">
                  <div>
                    <div className="font-semibold text-white">
                      {item.productName}, {item.variantName}
                    </div>
                    <div className="text-sm text-ink-300">
                      {line.quantityMilli / 1000} × {formatPeso(item.retailPriceCentavos)}
                    </div>
                  </div>
                  <strong className="text-white">
                    {formatPeso((item.retailPriceCentavos * line.quantityMilli) / 1000)}
                  </strong>
                </li>
              ) : null
            })}
          </ul>
          <div className="mt-auto flex items-baseline justify-between">
            <span className="text-lg font-bold text-white">Total due</span>
            <span className="font-display text-4xl font-bold text-white">{formatPeso(total)}</span>
          </div>
        </Glass>

        <section className="flex min-w-0 flex-col gap-5 p-1">
          <div className="grid grid-cols-3 gap-3">
            <button className="flex h-20 flex-col items-center justify-center gap-2 border border-gold-500/60 bg-gold-500/[0.18] font-semibold text-gold-100">
              <Banknote size={26} />
              Cash
            </button>
            <button
              disabled
              className="flex h-20 flex-col items-center justify-center gap-2 border border-white/10 bg-white/[0.03] text-ink-400"
            >
              <Smartphone size={26} />
              E-wallet
            </button>
            <button
              disabled
              className="flex h-20 flex-col items-center justify-center gap-2 border border-white/10 bg-white/[0.03] text-ink-400"
            >
              <CreditCard size={26} />
              Card
            </button>
          </div>
          <div className="flex flex-col gap-5 xl:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <label className="grid gap-2 text-sm font-semibold text-white">
                Cash received
                <input
                  inputMode="decimal"
                  value={received}
                  onChange={(event) => setReceived(event.target.value.replace(/[^0-9.]/g, ''))}
                  className="h-16 border-2 border-gold-500 bg-white/[0.08] px-4 font-display text-3xl font-bold text-white"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {[total, Math.ceil(total / 50000) * 50000, Math.ceil(total / 100000) * 100000]
                  .filter((value, index, values) => value > 0 && values.indexOf(value) === index)
                  .map((value) => (
                    <button
                      key={value}
                      onClick={() => setReceived((value / 100).toFixed(2))}
                      className={cn(
                        'min-h-12 border px-4 font-semibold',
                        receivedCentavos === value
                          ? 'border-gold-500 bg-gold-500/20 text-gold-100'
                          : 'border-white/20 bg-white/[0.08] text-white',
                      )}
                    >
                      {value === total ? `Exact ${formatPeso(value)}` : formatPeso(value)}
                    </button>
                  ))}
              </div>
              <Glass className="flex items-baseline justify-between p-4">
                <span className="font-semibold text-white">{enough ? 'Change due' : 'Still needed'}</span>
                <strong className="font-display text-3xl text-gold-300">
                  {formatPeso(enough ? receivedCentavos - total : total - receivedCentavos)}
                </strong>
              </Glass>
            </div>
            <Keypad mode="amount" onKey={onKey} className="w-full flex-none gap-2 xl:w-[330px]" />
          </div>
          <Button
            variant="primary"
            size="xl"
            className="mt-auto"
            disabled={!enough || busy}
            onClick={() => void complete()}
          >
            {busy ? 'Completing sale...' : `Complete sale · ${formatPeso(total)}`}
          </Button>
        </section>
      </div>
    </Surface>
  )
}
