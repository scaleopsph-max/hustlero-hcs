'use client'

import { Banknote, Building2, CheckCircle2, CreditCard, Smartphone, Trash2, WalletCards } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  posSalesContextSchema,
  requiresPaymentReference,
  type PosCustomer,
  type PosSaleCompleteResponse,
  type PosSalesContext,
  type PosPricingMode,
} from '@hcs/contracts'
import { Button, Glass, Keypad, Surface, cn, formatPeso, parsePeso } from '@hcs/ui'
import { SubHeader } from '@/components/SubHeader'
import {
  POS_CART_KEY,
  POS_CUSTOMER_KEY,
  POS_PRICING_TYPE_KEY,
  posRequest,
  readPosCart,
  readPosCustomer,
  readPosPricingType,
  readPosSession,
  type PosCartLine,
} from '@/lib/pos-api'
import { resolvePosPricing } from '@/lib/pos-pricing'
import { resolvePosDiscount } from '@/lib/pos-discounts'
import {
  createPendingPosSale,
  findPendingPosSale,
  definitivelyRejectedPosSale,
  posSaleScope,
  posSaleStorage,
  reconcilePosSale,
  requireOriginalPosScope,
  restorePendingPosSale,
  samePendingPosSale,
  type PendingPosSale,
} from '@/lib/pos-sale-recovery'

type PaymentMethod = PosSalesContext['paymentMethods'][number]
type PaymentAllocation = {
  paymentMethodId: string
  methodName: string
  methodType: PaymentMethod['type']
  amountCentavos: number
  tenderedCentavos: number
  referenceLastFour?: string
}

function PaymentIcon({ type }: { type: PaymentMethod['type'] }) {
  if (type === 'cash') return <Banknote size={24} />
  if (type === 'e_wallet') return <Smartphone size={24} />
  if (type === 'card_terminal') return <CreditCard size={24} />
  if (type === 'bank_transfer') return <Building2 size={24} />
  return <WalletCards size={24} />
}

export default function Checkout() {
  const router = useRouter()
  const [context, setContext] = useState<PosSalesContext | null>(null)
  const [lines, setLines] = useState<PosCartLine[]>([])
  const [customer, setCustomer] = useState<PosCustomer | null>(null)
  const [pricingType, setPricingType] = useState<PosPricingMode>('auto')
  const [selectedMethodId, setSelectedMethodId] = useState('')
  // Null means untouched: derive the initial value from this render's payable.
  // An explicit empty string is user input and must never be refilled by an effect.
  const [amount, setAmount] = useState<string | null>(null)
  const [received, setReceived] = useState<string | null>(null)
  const [referenceLastFour, setReferenceLastFour] = useState('')
  const [payments, setPayments] = useState<PaymentAllocation[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<PosSaleCompleteResponse | null>(null)
  const [discount, setDiscount] = useState<PendingPosSale['payload']['discount']>(null)
  const [pending, setPending] = useState<PendingPosSale | null>(null)
  const [dismissible, setDismissible] = useState(false)
  const commandLock = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    const session = readPosSession()
    if (!session) return router.replace('/')
    let restored: PendingPosSale | null
    try {
      const scope = posSaleScope(session)
      restored = findPendingPosSale(sessionStorage, scope)
      if (restored) requireOriginalPosScope(restored, scope)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Saved sale recovery is invalid.')
      return
    }
    const cart = restored?.payload.lines ?? readPosCart()
    if (!cart.length) return router.replace('/sell')
    setLines(cart)
    const savedCustomer = readPosCustomer()
    setCustomer(restored && savedCustomer?.id !== restored.payload.customerId ? null : savedCustomer)
    setPricingType(restored?.payload.pricingType ?? readPosPricingType())
    setPending(restored)
    setDiscount(restored?.payload.discount ?? null)
    void posRequest('/v1/pos/context')
      .then((data) => {
        const loaded = posSalesContextSchema.parse(data)
        if (!loaded.registerSession && !restored) return router.replace('/sell')
        setContext(loaded)
        setSelectedMethodId(
          loaded.paymentMethods.find((method) => method.type === 'cash')?.id ?? loaded.paymentMethods[0]?.id ?? '',
        )
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : 'Could not load checkout.')
        if (!readPosSession()) router.replace('/')
      })
  }, [router])

  const itemById = useMemo(() => new Map(context?.items.map((item) => [item.variantId, item]) ?? []), [context])
  const pricing = useMemo(
    () => resolvePosPricing(context?.items ?? [], lines, customer, pricingType),
    [context, customer, lines, pricingType],
  )
  const discountQuote = useMemo(
    () => resolvePosDiscount(pricing, lines, discount, context ?? {}),
    [pricing, lines, discount, context],
  )
  const total = pending
    ? pending.payload.payments.reduce((sum, row) => sum + row.amountCentavos, 0)
    : discountQuote.totalMinor
  const allocated = pending ? total : payments.reduce((sum, payment) => sum + payment.amountCentavos, 0)
  const remaining = Math.max(total - allocated, 0)
  const selectedMethod = context?.paymentMethods.find((method) => method.id === selectedMethodId)
  const inputMinor = (value: number) => {
    const minor = BigInt(value)
    return `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`
  }
  const amountText = amount ?? inputMinor(remaining)
  const receivedText = received ?? inputMinor(remaining)
  const amountCentavos = parsePeso(amountText)
  const tenderedCentavos = selectedMethod?.type === 'cash' ? parsePeso(receivedText) : amountCentavos
  const canAdd =
    discountQuote.eligible &&
    !pending &&
    Boolean(selectedMethod) &&
    amountCentavos > 0 &&
    amountCentavos <= remaining &&
    tenderedCentavos >= amountCentavos &&
    (!selectedMethod || !requiresPaymentReference(selectedMethod.type) || /^[0-9]{4}$/.test(referenceLastFour)) &&
    !payments.some((payment) => payment.paymentMethodId === selectedMethodId)

  function selectMethod(method: PaymentMethod) {
    setReferenceLastFour('')
    setSelectedMethodId(method.id)
    setAmount((remaining / 100).toFixed(2))
    setReceived(method.type === 'cash' ? (remaining / 100).toFixed(2) : '')
    setError(null)
  }

  function onKey(key: string) {
    const update = selectedMethod?.type === 'cash' ? setReceived : setAmount
    update((stored) => {
      const value = stored ?? (selectedMethod?.type === 'cash' ? receivedText : amountText)
      if (key === 'back') return value.slice(0, -1)
      if (key === 'clear') return ''
      if (key === '.' && value.includes('.')) return value
      return value.length < 10 ? value + key : value
    })
  }

  function addPayment() {
    if (!selectedMethod || !canAdd) return
    const nextRemaining = remaining - amountCentavos
    setPayments((current) => [
      ...current,
      {
        paymentMethodId: selectedMethod.id,
        methodName: selectedMethod.name,
        methodType: selectedMethod.type,
        amountCentavos,
        tenderedCentavos,
        ...(requiresPaymentReference(selectedMethod.type) ? { referenceLastFour } : {}),
      },
    ])
    const nextMethod = context?.paymentMethods.find(
      (method) => method.id !== selectedMethod.id && !payments.some((payment) => payment.paymentMethodId === method.id),
    )
    setSelectedMethodId(nextMethod?.id ?? '')
    setReferenceLastFour('')
    setAmount(nextRemaining > 0 ? (nextRemaining / 100).toFixed(2) : '')
    setReceived(nextMethod?.type === 'cash' && nextRemaining > 0 ? (nextRemaining / 100).toFixed(2) : '')
  }

  function removePayment(payment: PaymentAllocation) {
    setReferenceLastFour(payment.referenceLastFour ?? '')
    setPayments((current) => current.filter((candidate) => candidate.paymentMethodId !== payment.paymentMethodId))
    setSelectedMethodId(payment.paymentMethodId)
    setAmount((payment.amountCentavos / 100).toFixed(2))
    setReceived(payment.methodType === 'cash' ? (payment.tenderedCentavos / 100).toFixed(2) : '')
  }

  async function complete() {
    if (commandLock.current) return
    commandLock.current = true
    setBusy(true)
    setError(null)
    setDismissible(false)
    try {
      const session = readPosSession()
      if (!session) throw new Error('Sign in as the original cashier.')
      const scope = posSaleScope(session),
        storage = posSaleStorage(scope)
      let command = pending
      if (!command && context && JSON.stringify(posSaleScope(context)) !== JSON.stringify(scope))
        throw new Error('Sign in as the original cashier before completing this checkout.')
      if (command) requireOriginalPosScope(command, scope)
      const stored = findPendingPosSale(sessionStorage, scope)
      if (command ? !samePendingPosSale(command, stored) : stored !== null)
        throw new Error('Saved sale changed. Reload checkout to reconcile it.')
      if (!command) {
        if (!discountQuote.eligible || !payments.length || allocated !== total)
          throw new Error(discountQuote.error ?? 'Allocate the exact payable amount before completing the sale.')
        command = createPendingPosSale(scope, {
          lines,
          payments: payments.map(({ paymentMethodId, amountCentavos, tenderedCentavos, referenceLastFour }) => ({
            paymentMethodId,
            amountCentavos,
            tenderedCentavos,
            ...(referenceLastFour ? { referenceLastFour } : {}),
          })),
          customerId: customer?.id ?? null,
          pricingType,
          ...(discount ? { discount } : {}),
        })
      }
      requireOriginalPosScope(command, scope)
      sessionStorage.setItem(storage, JSON.stringify(command))
      setPending(command)
      const completed = reconcilePosSale(
        command,
        await posRequest('/v1/pos/sales/complete', {
          method: 'POST',
          headers: { 'Idempotency-Key': command.key },
          body: JSON.stringify(command.payload),
        }),
      )
      if (!mounted.current) throw new Error('Original sale remains pending until checkout is reopened.')
      const current = readPosSession()
      if (!current) throw new Error('Sign in as the original cashier to reconcile this sale.')
      requireOriginalPosScope(command, posSaleScope(current))
      if (!samePendingPosSale(command, restorePendingPosSale(sessionStorage.getItem(storage))))
        throw new Error('Saved sale changed. Reload checkout to reconcile it.')
      if (JSON.stringify(readPosCart()) === JSON.stringify(command.payload.lines)) {
        sessionStorage.removeItem(POS_CART_KEY)
        if ((readPosCustomer()?.id ?? null) === (command.payload.customerId ?? null))
          sessionStorage.removeItem(POS_CUSTOMER_KEY)
        if (readPosPricingType() === command.payload.pricingType) sessionStorage.removeItem(POS_PRICING_TYPE_KEY)
      }
      sessionStorage.removeItem(storage)
      setPending(null)
      setReceipt(completed)
    } catch (cause) {
      if (!mounted.current) return
      setDismissible(definitivelyRejectedPosSale((cause as { code?: string }).code))
      setError(cause instanceof Error ? cause.message : 'The sale could not be completed.')
    } finally {
      commandLock.current = false
      if (mounted.current) setBusy(false)
    }
  }

  function dismissRejected() {
    if (!pending || !dismissible || commandLock.current) return
    try {
      const session = readPosSession()
      if (!session) throw new Error('Sign in as the original cashier.')
      requireOriginalPosScope(pending, posSaleScope(session))
      const storage = posSaleStorage(pending.scope)
      if (!samePendingPosSale(pending, restorePendingPosSale(sessionStorage.getItem(storage))))
        throw new Error('Saved sale changed. Reload checkout to reconcile it.')
      sessionStorage.removeItem(storage)
      setPending(null)
      router.replace('/sell')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reconcile the saved sale.')
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
            {(receipt.discountCentavos ?? 0) > 0 && (
              <>
                <dt className="text-ink-300">Subtotal</dt>
                <dd className="text-right text-white">{formatPeso(receipt.subtotalCentavos)}</dd>
                <dt className="text-ink-300">{receipt.discountSnapshot?.name ?? 'Discount'}</dt>
                <dd className="text-right text-white">−{formatPeso(receipt.discountCentavos ?? 0)}</dd>
              </>
            )}
            <dt className="text-ink-300">Total</dt>
            <dd className="text-right font-bold text-white">{formatPeso(receipt.totalCentavos)}</dd>
            {receipt.payments.map((payment) => (
              <div key={payment.paymentMethodId} className="col-span-2 grid grid-cols-2 gap-3">
                <dt className="text-ink-300">
                  {payment.methodName}
                  {payment.referenceLastFour ? ` · Ref ${payment.referenceLastFour}` : ''}
                </dt>
                <dd className="text-right font-bold text-white">{formatPeso(payment.amountCentavos)}</dd>
              </div>
            ))}
            {receipt.changeCentavos > 0 ? (
              <>
                <dt className="text-ink-300">Change</dt>
                <dd className="text-right font-display text-2xl font-bold text-gold-300">
                  {formatPeso(receipt.changeCentavos)}
                </dd>
              </>
            ) : null}
            {receipt.customerId && receipt.loyaltyEarnedPoints > 0 ? (
              <>
                <dt className="text-ink-300">Loyalty earned</dt>
                <dd className="text-right font-bold text-emerald-300">+{receipt.loyaltyEarnedPoints} pts</dd>
                <dt className="text-ink-300">Point balance</dt>
                <dd className="text-right font-bold text-white">{receipt.loyaltyBalancePoints} pts</dd>
              </>
            ) : null}
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
        <p role={error ? 'alert' : undefined} className="text-ink-100">
          {error ?? 'Loading checkout...'}
        </p>
      </Surface>
    )

  return (
    <Surface tone="dark" className="flex min-h-screen flex-col gap-3 p-3">
      <SubHeader
        backHref={pending ? '/checkout' : '/sell'}
        backLabel={pending ? 'Saved sale' : 'Back to sale'}
        title="Payment"
        right={
          <span className="text-[13px] text-ink-300">
            {context.device.locationName}, {context.device.registerName}, {context.employee.displayName}
          </span>
        }
      />
      {error ? (
        <div role="alert" className="border-l-2 border-red-400 bg-red-950/60 p-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Glass variant="strong" as="aside" className="flex flex-col gap-4 rounded-[28px] p-6">
          <h2 className="font-display text-[22px] font-bold text-white">Order summary</h2>
          {customer ? (
            <div className="border-y border-white/10 py-3 text-sm">
              <span className="text-ink-300">Customer</span>
              <strong className="float-right text-white">
                {customer.fullName}
                {customer.loyaltyEnabled ? ` · ${customer.loyaltyBalancePoints} pts` : ''}
              </strong>
            </div>
          ) : null}
          <div className="flex items-center justify-between border-b border-white/10 pb-3 text-sm">
            <span className="text-ink-300">Pricing</span>
            <strong className="capitalize text-white">
              {pricingType}
              {pricing.priceListName ? ` · ${pricing.priceListName}` : ''}
            </strong>
          </div>
          {!pending && !discountQuote.eligible && discountQuote.error ? (
            <div className="border-l-2 border-amber-400 bg-amber-950/50 p-2 text-xs text-amber-100">
              {discountQuote.error}
            </div>
          ) : null}
          {!pending && (
            <label className="grid gap-2 text-sm text-white">
              Discount
              <select
                aria-label="Ticket discount"
                value={discount?.discountId ?? ''}
                disabled={busy || payments.length > 0 || !context.canApplyDiscount}
                onChange={(event) => {
                  const chosen = context.discounts?.find((row) => row.id === event.target.value)
                  const selection = chosen ? { discountId: chosen.id, expectedRevision: chosen.revision } : null
                  const nextQuote = resolvePosDiscount(pricing, lines, selection, context)
                  const minor = BigInt(nextQuote.totalMinor)
                  const nextAmount = nextQuote.eligible
                    ? `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`
                    : ''
                  setDiscount(selection)
                  setAmount(nextAmount)
                  setReceived(selectedMethod?.type === 'cash' ? nextAmount : '')
                  setError(null)
                }}
                className="min-h-12 w-full rounded border border-white/20 bg-ink-900 px-3 text-white"
              >
                <option value="">No discount</option>
                {context.discounts?.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
              {payments.length > 0 && (
                <span className="text-xs text-ink-300">Remove applied payments before changing the discount.</span>
              )}
            </label>
          )}
          {!pending && discountQuote.discountMinor > 0 && (
            <div className="grid grid-cols-2 gap-2 border-b border-white/10 pb-3 text-sm text-white">
              <span>Subtotal</span>
              <strong className="text-right">{formatPeso(pricing.totalCentavos)}</strong>
              <span>Discount</span>
              <strong className="text-right">−{formatPeso(discountQuote.discountMinor)}</strong>
            </div>
          )}
          <ul>
            {lines.map((line) => {
              const item = itemById.get(line.variantId)
              const resolved = pricing.lines.get(line.variantId)
              return item ? (
                <li key={line.variantId} className="flex justify-between gap-3 border-t border-white/10 py-3">
                  <div>
                    <div className="font-semibold text-white">
                      {item.productName}, {item.variantName}
                    </div>
                    {!pending && (
                      <div className="text-sm text-ink-300">
                        {line.quantityMilli / 1000} ×{' '}
                        {formatPeso(resolved?.unitPriceCentavos ?? item.retailPriceCentavos)}
                      </div>
                    )}
                  </div>
                  {!pending && (
                    <strong className="text-white">
                      {formatPeso(
                        resolved?.lineTotalCentavos ?? (item.retailPriceCentavos * line.quantityMilli) / 1000,
                      )}
                    </strong>
                  )}
                </li>
              ) : null
            })}
          </ul>
          {payments.length && !pending ? (
            <div className="border-t border-white/10 pt-3">
              <div className="mb-2 text-xs font-semibold uppercase text-ink-300">Applied payments</div>
              {payments.map((payment) => (
                <div
                  key={payment.paymentMethodId}
                  className="flex min-h-11 items-center gap-3 border-t border-white/10 py-2 text-sm"
                >
                  <PaymentIcon type={payment.methodType} />
                  <span className="flex-1 text-white">
                    {payment.methodName}
                    {payment.referenceLastFour ? ` · Ref ${payment.referenceLastFour}` : ''}
                  </span>
                  <strong className="text-white">{formatPeso(payment.amountCentavos)}</strong>
                  <button
                    type="button"
                    title={`Remove ${payment.methodName}`}
                    onClick={() => removePayment(payment)}
                    className="grid size-9 place-items-center text-ink-300 hover:text-red-300"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-auto grid gap-2 border-t border-white/10 pt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-bold text-white">{pending ? 'Saved payment total' : 'Total due'}</span>
              <span className="font-display text-3xl font-bold text-white">{formatPeso(total)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-ink-300">Remaining</span>
              <strong className="text-xl text-gold-300">{formatPeso(remaining)}</strong>
            </div>
          </div>
        </Glass>

        {pending ? (
          <section className="flex min-w-0 flex-col gap-5 p-4 text-white">
            <h2 className="text-xl font-semibold">Saved sale awaiting reconciliation</h2>
            <p>
              Retry sends the original cart, discount selection and payments with the same request key. Do not collect
              payment again while the result is unknown.
            </p>
            <Button disabled={busy} onClick={() => void complete()}>
              {busy ? 'Reconciling sale...' : 'Retry original sale'}
            </Button>
            {dismissible && (
              <Button disabled={busy} onClick={dismissRejected}>
                Discard rejected attempt and return to sale
              </Button>
            )}
          </section>
        ) : (
          <section className="flex min-w-0 flex-col gap-5 p-1">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {context.paymentMethods.map((method) => {
                const used = payments.some((payment) => payment.paymentMethodId === method.id)
                return (
                  <button
                    key={method.id}
                    type="button"
                    disabled={used || remaining === 0}
                    onClick={() => selectMethod(method)}
                    className={cn(
                      'flex h-20 min-w-0 flex-col items-center justify-center gap-2 border px-2 font-semibold',
                      method.id === selectedMethodId
                        ? 'border-gold-500/60 bg-gold-500/[0.18] text-gold-100'
                        : 'border-white/10 bg-white/[0.03] text-ink-200',
                      used && 'opacity-40',
                    )}
                  >
                    <PaymentIcon type={method.type} />
                    <span className="max-w-full truncate">{method.name}</span>
                  </button>
                )
              })}
            </div>
            {selectedMethod && remaining > 0 ? (
              <div className="flex flex-col gap-5 xl:flex-row">
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                  {requiresPaymentReference(selectedMethod.type) ? (
                    <label className="grid gap-2 text-sm font-semibold text-white">
                      Transaction reference (last 4 digits)
                      <input
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={4}
                        pattern="[0-9]{4}"
                        value={referenceLastFour}
                        onChange={(event) => setReferenceLastFour(event.target.value)}
                        className="h-12 border border-white/20 bg-white/[0.08] px-4 text-lg text-white"
                      />
                    </label>
                  ) : null}
                  <label className="grid gap-2 text-sm font-semibold text-white">
                    Amount to apply
                    <input
                      inputMode="decimal"
                      value={amountText}
                      onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ''))}
                      className="h-16 border-2 border-gold-500 bg-white/[0.08] px-4 font-display text-3xl font-bold text-white"
                    />
                  </label>
                  {selectedMethod.type === 'cash' ? (
                    <>
                      <label className="grid gap-2 text-sm font-semibold text-white">
                        Cash received
                        <input
                          inputMode="decimal"
                          value={receivedText}
                          onChange={(event) => setReceived(event.target.value.replace(/[^0-9.]/g, ''))}
                          className="h-16 border border-white/20 bg-white/[0.08] px-4 font-display text-3xl font-bold text-white"
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {[
                          amountCentavos,
                          Math.ceil(amountCentavos / 50000) * 50000,
                          Math.ceil(amountCentavos / 100000) * 100000,
                        ]
                          .filter((value, index, values) => value > 0 && values.indexOf(value) === index)
                          .map((value) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setReceived((value / 100).toFixed(2))}
                              className={cn(
                                'min-h-12 border px-4 font-semibold',
                                tenderedCentavos === value
                                  ? 'border-gold-500 bg-gold-500/20 text-gold-100'
                                  : 'border-white/20 bg-white/[0.08] text-white',
                              )}
                            >
                              {value === amountCentavos ? `Exact ${formatPeso(value)}` : formatPeso(value)}
                            </button>
                          ))}
                      </div>
                      <Glass className="flex items-baseline justify-between p-4">
                        <span className="font-semibold text-white">Change due</span>
                        <strong className="font-display text-3xl text-gold-300">
                          {formatPeso(Math.max(tenderedCentavos - amountCentavos, 0))}
                        </strong>
                      </Glass>
                    </>
                  ) : (
                    <Glass className="p-4 text-sm text-ink-200">
                      {selectedMethod.name} will record exactly {formatPeso(amountCentavos)}. Confirm the external
                      terminal or wallet before completing the sale.
                    </Glass>
                  )}
                </div>
                <Keypad mode="amount" onKey={onKey} className="w-full flex-none gap-2 xl:w-[330px]" />
              </div>
            ) : null}
            {remaining > 0 ? (
              <Button variant="primary" size="xl" className="mt-auto" disabled={!canAdd || busy} onClick={addPayment}>
                Add {selectedMethod?.name ?? 'payment'} · {formatPeso(amountCentavos)}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="xl"
                className="mt-auto"
                disabled={!payments.length || busy || !discountQuote.eligible}
                onClick={() => void complete()}
              >
                {busy ? 'Completing sale...' : `Complete sale · ${formatPeso(total)}`}
              </Button>
            )}
          </section>
        )}
      </div>
    </Surface>
  )
}
