'use client'

import {
  posRegisterCloseResponseSchema,
  posSalesContextSchema,
  type PosRegisterCloseResponse,
  type PosSalesContext,
} from '@hcs/contracts'
import { Button, Glass, Surface, cn, formatPeso, formatPesoSigned } from '@hcs/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { SubHeader } from '@/components/SubHeader'
import { POS_SESSION_KEY, newIdempotencyKey, posRequest, readPosSession } from '@/lib/pos-api'
import { billDenominations, countedCentavos, type BillCounts } from '@/lib/register-close'

const time = (value: string) =>
  new Date(value).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })

/**
 * Close register (spec 10.1 and 10.3). Blind count: the cashier enters what is in the drawer before seeing
 * what was expected. Any difference still closes the session, as an exception the owner resolves in the
 * Back Office; it is never closed silently.
 */
export default function CloseRegister() {
  const router = useRouter()
  const [context, setContext] = useState<PosSalesContext | null>(null)
  const [bills, setBills] = useState<BillCounts>({})
  const [coins, setCoins] = useState('')
  const [note, setNote] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PosRegisterCloseResponse | null>(null)
  // One key per close attempt, so a retry after a dropped connection cannot close twice.
  const [requestKey] = useState(() => newIdempotencyKey('register_close'))

  useEffect(() => {
    if (!readPosSession()) {
      router.replace('/')
      return
    }
    posRequest('/v1/pos/context')
      .then((value) => {
        const loaded = posSalesContextSchema.parse(value)
        if (!loaded.registerSession) router.replace('/sell')
        else setContext(loaded)
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load the register.'))
  }, [router])

  const counted = countedCentavos(bills, coins)

  async function close() {
    setBusy(true)
    setError(null)
    try {
      setResult(
        posRegisterCloseResponseSchema.parse(
          await posRequest('/v1/pos/register-sessions/close', {
            method: 'POST',
            headers: { 'Idempotency-Key': requestKey },
            body: JSON.stringify({ countedCashCentavos: counted, ...(note.trim() ? { note: note.trim() } : {}) }),
          }),
        ),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The register did not close. Try again.')
      setReviewing(false)
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

  const opened = context.registerSession ? time(context.registerSession.openedAt) : ''

  return (
    <Surface tone="dark" className="flex min-h-screen flex-col gap-3 p-3">
      <SubHeader
        backHref="/sell"
        backLabel="Back to sales"
        title="Close register"
        subtitle={`${context.device.locationName}, ${context.device.registerName}, opened ${opened} by ${context.employee.displayName}`}
      />

      {error ? (
        <div role="alert" className="border-l-2 border-red-400 bg-red-950/60 p-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {result ? (
        <CloseResult result={result} onSignOut={signOut} onOpenAgain={() => router.replace('/sell')} />
      ) : (
        <div className="grid min-h-0 flex-1 items-start gap-4 overflow-y-auto lg:grid-cols-[minmax(0,540px)_minmax(0,1fr)]">
          <Glass variant="strong" className="flex flex-col rounded-[28px] px-6 py-5">
            <div className="flex flex-col gap-0.5 pb-3">
              <h2 className="font-display text-[22px] font-bold leading-7 text-white">Count the cash</h2>
              <span className="text-sm text-ink-200">
                Count every bill and coin in the drawer. The expected amount shows after you close.
              </span>
            </div>
            {billDenominations.map((bill) => {
              const pieces = Number.parseInt(bills[bill.id] ?? '', 10) || 0
              return (
                <div key={bill.id} className="flex min-h-[52px] items-center gap-3 border-t border-white/10">
                  <label htmlFor={bill.id} className="flex-1 text-[15px] font-semibold text-white">
                    {bill.label} bills
                  </label>
                  <input
                    id={bill.id}
                    inputMode="numeric"
                    placeholder="0"
                    disabled={reviewing}
                    value={bills[bill.id] ?? ''}
                    onChange={(event) =>
                      setBills((current) => ({
                        ...current,
                        [bill.id]: event.target.value.replace(/\D/g, '').slice(0, 5),
                      }))
                    }
                    className="h-11 w-24 rounded-control border border-white/[0.28] bg-white/[0.06] px-3 text-right text-base font-semibold text-white"
                  />
                  <span className="w-28 text-right text-[15px] text-ink-100">{formatPeso(bill.unit * pieces)}</span>
                </div>
              )
            })}
            <div className="flex min-h-[52px] items-center gap-3 border-t border-white/10">
              <label htmlFor="coins" className="flex-1 text-[15px] font-semibold text-white">
                Coins, total in pesos
              </label>
              <input
                id="coins"
                inputMode="decimal"
                placeholder="0.00"
                disabled={reviewing}
                value={coins}
                onChange={(event) => setCoins(event.target.value.replace(/[^0-9.]/g, '').slice(0, 10))}
                className="h-11 w-32 rounded-control border border-white/[0.28] bg-white/[0.06] px-3 text-right text-base font-semibold text-white"
              />
            </div>
            <div className="flex items-baseline justify-between border-t-2 border-gold-500 pt-3.5">
              <span className="text-[17px] font-bold text-white">Counted cash</span>
              <span className="font-display text-[32px] font-bold leading-9 text-gold-300">{formatPeso(counted)}</span>
            </div>
          </Glass>

          <Glass className="flex flex-col gap-4 rounded-[28px] px-6 py-5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="close-note" className="text-sm font-semibold text-white">
                Note for the owner (optional)
              </label>
              <textarea
                id="close-note"
                maxLength={500}
                disabled={reviewing}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Anything the owner should know, e.g. a wrong change or a cash payout"
                className="h-[88px] resize-none rounded-[14px] border border-white/[0.28] bg-white/[0.06] px-3.5 py-2.5 text-[15px] text-white placeholder:text-ink-300"
              />
            </div>
            {reviewing ? (
              <div className="flex flex-col gap-3 rounded-[18px] border border-gold-500/60 bg-gold-500/10 p-4">
                <p className="text-[15px] leading-6 text-white">
                  Close {context.device.registerName} with <strong>{formatPeso(counted)}</strong> counted? This ends the
                  session. You cannot change the count afterward.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" disabled={busy} onClick={() => void close()}>
                    {busy ? 'Closing...' : 'Yes, close register'}
                  </Button>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => setReviewing(false)}>
                    Recount
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="primary" size="xl" onClick={() => setReviewing(true)}>
                Close register with {formatPeso(counted)}
              </Button>
            )}
            <p className="text-sm leading-5 text-ink-300">
              If the drawer is short or over, the register still closes and the owner is alerted to review it.
            </p>
          </Glass>
        </div>
      )}
    </Surface>
  )
}

function CloseResult({
  result,
  onSignOut,
  onOpenAgain,
}: {
  result: PosRegisterCloseResponse
  onSignOut: () => void
  onOpenAgain: () => void
}) {
  const exact = result.varianceCentavos === 0
  const rows: [string, number][] = [
    ['Opening cash', result.cash.openingCentavos],
    ['Cash sales', result.cash.salesCentavos],
    ['Cash refunds', result.cash.refundsCentavos],
    ['Other cash in and out', result.cash.otherCentavos],
  ]
  return (
    <div className="grid min-h-0 flex-1 items-start gap-4 overflow-y-auto lg:grid-cols-2">
      <section
        className={cn(
          'flex flex-col gap-4 rounded-[28px] border p-6 backdrop-blur-glass',
          exact
            ? 'border-signal-dark-success-fg/40 bg-signal-dark-success-bg'
            : 'border-signal-dark-warning-fg/50 bg-signal-dark-warning-bg',
        )}
      >
        <span
          className={cn(
            'font-display text-[30px] font-bold leading-[34px]',
            exact ? 'text-signal-dark-success-fg' : 'text-signal-dark-warning-fg',
          )}
        >
          {exact
            ? 'Cash matches exactly'
            : `${result.varianceCentavos < 0 ? 'Short by' : 'Over by'} ${formatPeso(Math.abs(result.varianceCentavos))}`}
        </span>
        <p className="text-[15px] leading-6 text-ink-50">
          {exact
            ? 'The register is closed.'
            : 'The register is closed and flagged for the owner to review in the Back Office.'}
        </p>
        <dl className="grid grid-cols-3 gap-3 text-white">
          <div>
            <dt className="text-xs text-ink-200">Expected</dt>
            <dd className="text-lg font-bold">{formatPeso(result.expectedCashCentavos)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-200">Counted</dt>
            <dd className="text-lg font-bold">{formatPeso(result.countedCashCentavos)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-200">Difference</dt>
            <dd className="text-lg font-bold">{formatPesoSigned(result.varianceCentavos)}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={onSignOut}>
            Sign out
          </Button>
          <Button variant="secondary" size="sm" onClick={onOpenAgain}>
            Open the register again
          </Button>
        </div>
      </section>

      <Glass className="flex flex-col rounded-[28px] px-6 py-5">
        <h2 className="mb-2 font-display text-[22px] font-bold leading-7 text-white">Shift summary</h2>
        {rows.map(([label, amount]) => (
          <div key={label} className="flex min-h-9 items-center justify-between border-t border-white/10 text-[15px]">
            <span className="text-ink-200">{label}</span>
            <span className="font-semibold text-white">
              {label === 'Opening cash' ? formatPeso(amount) : formatPesoSigned(amount)}
            </span>
          </div>
        ))}
        <div className="flex items-baseline justify-between border-t-2 border-white/30 pt-3">
          <span className="text-[17px] font-bold text-white">Expected cash</span>
          <span className="text-xl font-bold text-white">{formatPeso(result.expectedCashCentavos)}</span>
        </div>
        {result.nonCash.length ? (
          <>
            <h3 className="mb-1 mt-5 text-sm font-semibold text-white">Other payments (not in the drawer)</h3>
            {result.nonCash.map((entry) => (
              <div
                key={entry.method}
                className="flex min-h-9 items-center justify-between border-t border-white/10 text-[15px]"
              >
                <span className="text-ink-200">{entry.method}</span>
                <span className="font-semibold text-white">{formatPeso(entry.amountCentavos)}</span>
              </div>
            ))}
          </>
        ) : null}
        <p className="mt-4 text-sm text-ink-300">
          {result.salesCount} {result.salesCount === 1 ? 'sale' : 'sales'} this session.
        </p>
      </Glass>
    </div>
  )
}
