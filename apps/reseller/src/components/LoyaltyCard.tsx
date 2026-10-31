'use client'

import type { ResellerLoyalty } from '@hcs/contracts'
import { Glass, formatPeso } from '@hcs/ui'
import { ChevronDown, Star } from 'lucide-react'
import { useEffect, useState } from 'react'

import { formatDateTime } from '@/lib/labels'

/** Points balance, how points are earned, and recent earns and reversals. */
export function LoyaltyCard({
  load,
  fallbackPoints,
}: {
  load: () => Promise<ResellerLoyalty>
  fallbackPoints: number
}) {
  const [loyalty, setLoyalty] = useState<ResellerLoyalty | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    load()
      .then(setLoyalty)
      .catch(() => setLoyalty(null))
  }, [load])

  const balance = loyalty?.balancePoints ?? fallbackPoints
  return (
    <Glass variant="gold" className="flex flex-col gap-3 rounded-glass p-4">
      <div className="flex items-center gap-3">
        <Star size={24} className="flex-none text-gold-300" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{balance.toLocaleString('en-PH')} points</p>
          <p className="text-small text-ink-200">
            {loyalty?.enabled && loyalty.spendPerPointMinor
              ? `1 point for every ${formatPeso(loyalty.spendPerPointMinor)} of delivered or picked-up orders, after discounts.`
              : 'The business has not turned on points yet.'}
          </p>
        </div>
      </div>
      {loyalty && loyalty.history.length > 0 ? (
        <div>
          <button
            type="button"
            className="flex w-full items-center justify-between text-small font-semibold"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            Points history
            <ChevronDown size={16} className={open ? 'rotate-180 transition' : 'transition'} />
          </button>
          {open ? (
            <ul className="mt-2 flex flex-col gap-2 text-small">
              {loyalty.history.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p>
                      {entry.type === 'sale_earn' ? 'Earned' : 'Returned items'}
                      {entry.orderNumber
                        ? ` · ${entry.orderNumber}`
                        : entry.invoiceNumber
                          ? ` · ${entry.invoiceNumber}`
                          : entry.receiptNumber
                            ? ` · ${entry.receiptNumber}`
                            : ''}
                    </p>
                    <p className="text-caption text-ink-300">
                      {formatDateTime(entry.occurredAt)} · balance {entry.balanceAfter.toLocaleString('en-PH')}
                    </p>
                  </div>
                  <p
                    className={
                      entry.points > 0 ? 'font-semibold text-signal-dark-success-fg' : 'font-semibold text-ink-200'
                    }
                  >
                    {entry.points > 0 ? `+${entry.points}` : entry.points}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Glass>
  )
}
