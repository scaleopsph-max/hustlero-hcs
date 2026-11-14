'use client'

import type { ResellerAccountControls, ResellerPortalAdmin } from '@hcs/contracts'
import { Button, cn, formatPeso, parsePeso } from '@hcs/ui'
import { useState } from 'react'

type Account = ResellerPortalAdmin['accounts'][number]

const tierClass = {
  silver: 'bg-slate-200 text-slate-800',
  gold: 'bg-amber-200 text-amber-900',
  platinum: 'bg-indigo-100 text-indigo-900',
} as const

export function TierChip({ tier }: { tier: Account['tier'] }) {
  if (!tier) return null
  return (
    <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide', tierClass[tier])}>
      {tier}
    </span>
  )
}

const control = 'min-h-10 w-full rounded-control border border-ink-900/15 bg-white px-3 text-sm'

/** Credit hold, a credit limit just for this reseller, and who referred them. */
export function AccountTierControls({
  account,
  accounts,
  busy,
  onSave,
}: {
  account: Account
  accounts: Account[]
  busy: boolean
  onSave: (body: ResellerAccountControls) => Promise<boolean>
}) {
  const [hold, setHold] = useState(account.creditHold ?? false)
  const [limit, setLimit] = useState(
    account.creditLimitOverrideMinor == null ? '' : String(account.creditLimitOverrideMinor / 100),
  )
  const [referrer, setReferrer] = useState(account.referredByAccountId ?? '')
  const [problem, setProblem] = useState<string | null>(null)

  return (
    <form
      className="grid gap-3 rounded-control bg-ink-900/[0.03] p-4 md:grid-cols-[auto,1fr,1fr,auto] md:items-end"
      onSubmit={(event) => {
        event.preventDefault()
        if (limit.trim() && !/^\d[\d,]*(\.\d{0,2})?$/.test(limit.trim()))
          return setProblem('Enter a peso amount, or leave it blank to use the Platinum default.')
        setProblem(null)
        void onSave({
          creditHold: hold,
          creditLimitOverrideMinor: limit.trim() ? parsePeso(limit) : null,
          referredByAccountId: referrer || null,
        })
      }}
    >
      <label className="flex min-h-10 items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={hold} onChange={(event) => setHold(event.target.checked)} />
        Credit hold
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Credit limit for this reseller (₱)
        <input
          className={control}
          inputMode="decimal"
          placeholder="Platinum default"
          value={limit}
          onChange={(event) => setLimit(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Referred by
        <select className={control} value={referrer} onChange={(event) => setReferrer(event.target.value)}>
          <option value="">Nobody</option>
          {accounts
            .filter((entry) => entry.id !== account.id)
            .map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.customerName}
              </option>
            ))}
        </select>
      </label>
      <Button type="submit" variant="confirm" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
      <p className="text-xs text-ink-500 md:col-span-4">
        Credit hold keeps the tier but makes every order pay-first. The limit applies only while they are Platinum.
        {account.lifetimeSalesMinor !== undefined
          ? ` Total sales ${formatPeso(account.lifetimeSalesMinor)} · ${account.activeReferrals ?? 0} active referrals.`
          : ''}
      </p>
      {problem ? <p className="text-sm text-signal-light-critical-fg md:col-span-4">{problem}</p> : null}
    </form>
  )
}
