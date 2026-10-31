'use client'

import type { ResellerTierSettings } from '@hcs/contracts'
import { Button, Glass, parsePeso } from '@hcs/ui'
import { Award } from 'lucide-react'
import { useState, type FormEvent } from 'react'

const control = 'min-h-10 w-full rounded-control border border-ink-900/15 bg-white px-3 text-sm'
const pesos = (minor: number) => String(minor / 100)
const amountPattern = /^\d[\d,]*(\.\d{0,2})?$/

/** Silver, Gold, Platinum: what each tier needs, its points rate, and Platinum credit. */
export function TierSettingsCard({
  settings,
  busy,
  onSave,
}: {
  settings: ResellerTierSettings
  busy: boolean
  onSave: (body: ResellerTierSettings) => Promise<boolean>
}) {
  const initial = {
    goldReferrals: String(settings.goldMinReferrals),
    goldSales: pesos(settings.goldMinSalesMinor),
    platinumReferrals: String(settings.platinumMinReferrals),
    platinumSales: pesos(settings.platinumMinSalesMinor),
    silverPoint: pesos(settings.silverSpendPerPointMinor),
    goldPoint: pesos(settings.goldSpendPerPointMinor),
    platinumPoint: pesos(settings.platinumSpendPerPointMinor),
    creditLimit: pesos(settings.platinumCreditLimitMinor),
    term: settings.platinumPaymentTerm,
    activeDays: String(settings.activeDays),
  }
  const [form, setForm] = useState(initial)
  const [problem, setProblem] = useState<string | null>(null)
  const changed = JSON.stringify(form) !== JSON.stringify(initial)
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    const whole = [form.goldReferrals, form.platinumReferrals, form.activeDays]
    const money = [
      form.goldSales,
      form.platinumSales,
      form.silverPoint,
      form.goldPoint,
      form.platinumPoint,
      form.creditLimit,
    ]
    if (whole.some((value) => !/^\d+$/.test(value.trim())) || money.some((value) => !amountPattern.test(value.trim())))
      return setProblem('Use whole numbers for resellers and days, and peso amounts like 200000 or 80.')
    const body: ResellerTierSettings = {
      goldMinReferrals: Number(form.goldReferrals),
      goldMinSalesMinor: parsePeso(form.goldSales),
      platinumMinReferrals: Number(form.platinumReferrals),
      platinumMinSalesMinor: parsePeso(form.platinumSales),
      silverSpendPerPointMinor: parsePeso(form.silverPoint),
      goldSpendPerPointMinor: parsePeso(form.goldPoint),
      platinumSpendPerPointMinor: parsePeso(form.platinumPoint),
      platinumCreditLimitMinor: parsePeso(form.creditLimit),
      platinumPaymentTerm: form.term,
      activeDays: Number(form.activeDays),
    }
    if (body.platinumMinReferrals <= body.goldMinReferrals || body.platinumMinSalesMinor <= body.goldMinSalesMinor)
      return setProblem('Platinum must need more resellers and more sales than Gold.')
    if (
      [body.silverSpendPerPointMinor, body.goldSpendPerPointMinor, body.platinumSpendPerPointMinor].some((v) => v < 100)
    )
      return setProblem('Points need at least ₱1 per point.')
    if (body.activeDays < 7 || body.activeDays > 365) return setProblem('Active means an order within 7 to 365 days.')
    setProblem(null)
    await onSave(body)
  }

  return (
    <Glass variant="data" className="flex flex-col gap-4 rounded-panel p-5">
      <div className="flex items-start gap-3">
        <Award size={20} className="mt-0.5 flex-none text-gold-700" />
        <div>
          <h3 className="font-semibold">Reseller tiers</h3>
          <p className="text-sm text-ink-500">
            A reseller moves up when they reach <strong>either</strong> the number of active resellers they referred or
            the total sales. Tiers update by themselves. Only Platinum can order on credit.
          </p>
        </div>
      </div>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-ink-500">
              <tr>
                <th className="py-2 pr-3">Tier</th>
                <th className="py-2 pr-3">Active resellers referred</th>
                <th className="py-2 pr-3">or total sales (₱)</th>
                <th className="py-2">₱ per point</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-ink-900/10">
                <td className="py-2 pr-3 font-semibold">Silver</td>
                <td className="py-2 pr-3 text-ink-500">Start</td>
                <td className="py-2 pr-3 text-ink-500">Start</td>
                <td className="py-2">
                  <input
                    aria-label="Silver pesos per point"
                    className={control}
                    inputMode="decimal"
                    value={form.silverPoint}
                    onChange={set('silverPoint')}
                  />
                </td>
              </tr>
              <tr className="border-t border-ink-900/10">
                <td className="py-2 pr-3 font-semibold">Gold</td>
                <td className="py-2 pr-3">
                  <input
                    aria-label="Gold active resellers"
                    className={control}
                    inputMode="numeric"
                    value={form.goldReferrals}
                    onChange={set('goldReferrals')}
                  />
                </td>
                <td className="py-2 pr-3">
                  <input
                    aria-label="Gold total sales"
                    className={control}
                    inputMode="decimal"
                    value={form.goldSales}
                    onChange={set('goldSales')}
                  />
                </td>
                <td className="py-2">
                  <input
                    aria-label="Gold pesos per point"
                    className={control}
                    inputMode="decimal"
                    value={form.goldPoint}
                    onChange={set('goldPoint')}
                  />
                </td>
              </tr>
              <tr className="border-t border-ink-900/10">
                <td className="py-2 pr-3 font-semibold">Platinum</td>
                <td className="py-2 pr-3">
                  <input
                    aria-label="Platinum active resellers"
                    className={control}
                    inputMode="numeric"
                    value={form.platinumReferrals}
                    onChange={set('platinumReferrals')}
                  />
                </td>
                <td className="py-2 pr-3">
                  <input
                    aria-label="Platinum total sales"
                    className={control}
                    inputMode="decimal"
                    value={form.platinumSales}
                    onChange={set('platinumSales')}
                  />
                </td>
                <td className="py-2">
                  <input
                    aria-label="Platinum pesos per point"
                    className={control}
                    inputMode="decimal"
                    value={form.platinumPoint}
                    onChange={set('platinumPoint')}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Platinum credit limit (₱)
            <input className={control} inputMode="decimal" value={form.creditLimit} onChange={set('creditLimit')} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Platinum terms
            <select
              className={control}
              value={form.term}
              onChange={(event) =>
                setForm({ ...form, term: event.target.value as ResellerTierSettings['platinumPaymentTerm'] })
              }
            >
              <option value="cod">Cash on delivery</option>
              <option value="net_7">Net 7 days</option>
              <option value="net_15">Net 15 days</option>
              <option value="net_30">Net 30 days</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Active means an order within (days)
            <input className={control} inputMode="numeric" value={form.activeDays} onChange={set('activeDays')} />
          </label>
        </div>
        <p className="text-xs text-ink-500">
          Total sales are delivered or picked-up items less returns, without shipping. Credit orders earn points only
          once paid. Platinum resellers with an overdue invoice or on credit hold order pay-first.
        </p>
        {problem ? <p className="text-sm text-signal-light-critical-fg">{problem}</p> : null}
        {changed ? (
          <Button type="submit" variant="confirm" className="self-start" disabled={busy}>
            {busy ? 'Saving…' : 'Save tiers'}
          </Button>
        ) : null}
      </form>
    </Glass>
  )
}
