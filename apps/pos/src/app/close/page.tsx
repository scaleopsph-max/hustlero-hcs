'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Glass, Keypad, Surface, cn, formatPeso, formatPesoSigned } from '@hcs/ui'
import { SubHeader } from '@/components/SubHeader'
import { VARIANCE_LIMIT, denominations, reconciliation } from '@/mock/pos'

/**
 * POS 4: close register (spec section 10.1 and 10.3).
 * Register close is NOT clock out. Large variance needs manager approval and raises an alert.
 * A problematic register is never closed silently.
 */
export default function CloseRegister() {
  const router = useRouter()
  const [counts, setCounts] = useState<Record<string, string>>(
    Object.fromEntries(denominations.map((d) => [d.id, String(d.count)])),
  )
  const [reason, setReason] = useState('')
  const [askingPin, setAskingPin] = useState(false)
  const [pin, setPin] = useState('')
  const [approved, setApproved] = useState(false)

  const counted = denominations.reduce((s, d) => s + d.unit * (parseInt(counts[d.id] || '0', 10) || 0), 0)
  const expected = reconciliation.reduce((s, r) => s + r.amount, 0)
  const variance = counted - expected
  const needsApproval = Math.abs(variance) > VARIANCE_LIMIT
  const canClose = !needsApproval || approved

  function onPinKey(key: string) {
    if (key === 'clear') return setPin('')
    if (key === 'back') return setPin((p) => p.slice(0, -1))
    const next = (pin + key).slice(0, 4)
    setPin(next)
    if (next.length === 4) {
      // TODO: POST /approvals/{id}/manager-pin. The approval is action-specific (this register close only) and audited.
      setApproved(true)
      setAskingPin(false)
      setPin('')
    }
  }

  function close() {
    // TODO: POST /registers/{id}/close with counted cash, variance and reason. Raise the CASH_VARIANCE_DETECTED alert server-side.
    router.push('/')
  }

  return (
    <Surface
      tone="dark"
      className="flex h-screen min-h-[800px] flex-col gap-3 p-3"
      glows={[
        { color: 'gold', className: 'left-[700px] top-[260px] size-[520px] opacity-25' },
        { color: 'gold', className: '-left-36 -top-24 size-[480px] opacity-20' },
        { color: 'gray', className: 'left-[200px] top-[480px] size-[480px] opacity-30' },
      ]}
    >
      <SubHeader
        backHref="/sell"
        backLabel="Back to sales"
        title="Close register"
        subtitle="Main Branch, Register 1, opened 7:58 AM by Ana R."
      />

      <div className="grid min-h-0 flex-1 grid-cols-[540px_minmax(0,1fr)] items-start gap-4 overflow-y-auto">
        <div className="flex flex-col gap-3.5">
          <Glass variant="strong" className="flex flex-col rounded-[28px] px-6 py-5">
            <div className="flex flex-col gap-0.5 pb-3">
              <h2 className="font-display text-[22px] font-bold leading-7 text-white">Count the cash</h2>
              <span className="text-sm text-ink-200">Count every note and coin in the drawer.</span>
            </div>
            {denominations.map((d) => {
              const c = parseInt(counts[d.id] || '0', 10) || 0
              return (
                <div key={d.id} className="flex min-h-[52px] items-center gap-3 border-t border-white/10">
                  <label htmlFor={d.id} className="flex-1 text-[15px] font-semibold text-white">
                    {d.label}
                  </label>
                  <input
                    id={d.id}
                    inputMode="numeric"
                    value={counts[d.id]}
                    onChange={(e) => setCounts((s) => ({ ...s, [d.id]: e.target.value.replace(/\D/g, '') }))}
                    className="h-11 w-24 rounded-control border border-white/[0.28] bg-white/[0.06] px-3 text-right text-base font-semibold text-white"
                  />
                  <span className="w-28 text-right text-[15px] text-ink-100">{formatPeso(d.unit * c)}</span>
                </div>
              )
            })}
            <div className="flex items-baseline justify-between border-t-2 border-gold-500 pt-3.5">
              <span className="text-[17px] font-bold text-white">Counted cash</span>
              <span className="font-display text-[32px] font-bold leading-9 text-gold-300">{formatPeso(counted)}</span>
            </div>
          </Glass>
          <div className="flex flex-col gap-2">
            <Button variant="primary" size="xl" disabled={!canClose} onClick={close} aria-describedby="close-hint">
              Close register
            </Button>
            <p id="close-hint" className="text-sm leading-5 text-ink-200">
              {canClose
                ? 'Ready to close. This ends the register session for Ana R.'
                : 'Closing unlocks after a manager approves the difference. The register never closes on its own.'}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3.5">
          <Glass className="flex flex-col rounded-[28px] px-6 py-5">
            <h2 className="mb-2 font-display text-[22px] font-bold leading-7 text-white">Expected cash</h2>
            {reconciliation.map((r) => (
              <div
                key={r.label}
                className="flex min-h-9 items-center justify-between border-t border-white/10 text-[15px]"
              >
                <span className="text-ink-200">{r.label}</span>
                <span className="font-semibold text-white">
                  {r.label === 'Opening cash' ? formatPeso(r.amount) : formatPesoSigned(r.amount)}
                </span>
              </div>
            ))}
            <div className="flex items-baseline justify-between border-t-2 border-white/30 pt-3">
              <span className="text-[17px] font-bold text-white">Expected cash</span>
              <span className="text-xl font-bold text-white">{formatPeso(expected)}</span>
            </div>
          </Glass>

          {variance === 0 ? (
            <Glass className="rounded-[28px] p-6">
              <span className="font-display text-[26px] font-bold text-signal-dark-success-fg">
                Cash matches exactly
              </span>
            </Glass>
          ) : (
            <section
              className={cn(
                'flex flex-col gap-3.5 rounded-[28px] border p-6 backdrop-blur-glass',
                needsApproval && !approved
                  ? 'border-signal-dark-warning-fg/50 bg-signal-dark-warning-bg'
                  : 'border-white/[0.14] bg-white/[0.07]',
              )}
            >
              <div className="flex items-baseline justify-between gap-4">
                <span
                  className={cn(
                    'font-display text-[30px] font-bold leading-[34px]',
                    needsApproval && !approved ? 'text-signal-dark-warning-fg' : 'text-white',
                  )}
                >
                  {variance < 0 ? 'Short by' : 'Over by'} {formatPeso(Math.abs(variance))}
                </span>
                <span
                  className={cn(
                    'inline-flex h-[26px] items-center rounded-full px-3 text-xs font-bold',
                    approved
                      ? 'bg-signal-dark-success-bg text-signal-dark-success-fg'
                      : needsApproval
                        ? 'bg-signal-dark-warning-fg text-ink-950'
                        : 'bg-white/10 text-ink-200',
                  )}
                >
                  {approved ? 'Approved by manager' : needsApproval ? 'Needs approval' : 'Within limit'}
                </span>
              </div>
              <p className="text-[15px] leading-[22px] text-ink-50">
                {needsApproval
                  ? `This is over your ${formatPeso(VARIANCE_LIMIT)} variance limit, so a manager must approve before the register closes. An alert will be raised either way.`
                  : `This is within your ${formatPeso(VARIANCE_LIMIT)} variance limit. It is still recorded on the cash ledger.`}
              </p>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pos-reason" className="text-sm font-semibold text-white">
                  Reason for the difference
                </label>
                <textarea
                  id="pos-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Tell the manager what you think happened"
                  className="h-[72px] resize-none rounded-[14px] border border-white/[0.28] bg-white/[0.06] px-3.5 py-2.5 text-[15px] text-white placeholder:text-ink-300"
                />
              </div>
              {needsApproval && !approved ? (
                askingPin ? (
                  <div className="flex items-center gap-5">
                    <div className="flex flex-col gap-2">
                      <span className="text-sm font-semibold text-white">Manager PIN</span>
                      <div className="flex gap-2.5" role="img" aria-label={`${pin.length} of 4 digits entered`}>
                        {[0, 1, 2, 3].map((i) => (
                          <span
                            key={i}
                            className={cn(
                              'size-3.5 rounded-full border-2',
                              i < pin.length ? 'border-gold-500 bg-gold-500' : 'border-white/45',
                            )}
                          />
                        ))}
                      </div>
                    </div>
                    <Keypad
                      mode="pin"
                      onKey={onPinKey}
                      className="w-[260px] gap-2 [&>button]:min-h-touch [&>button]:text-xl"
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-ink-100">Manager approval applies only to this register close.</span>
                    <Button variant="confirm" className="flex-none" onClick={() => setAskingPin(true)}>
                      Enter manager PIN
                    </Button>
                  </div>
                )
              ) : null}
            </section>
          )}
        </div>
      </div>
    </Surface>
  )
}
